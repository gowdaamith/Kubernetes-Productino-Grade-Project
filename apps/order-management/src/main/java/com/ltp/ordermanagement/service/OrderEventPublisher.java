package com.ltp.ordermanagement.service;

import com.ltp.ordermanagement.model.Order;
import com.ltp.ordermanagement.model.OrderCompletedEvent;
import com.ltp.ordermanagement.repository.OrderRepository;
import com.mongodb.client.result.UpdateResult;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.amqp.core.ReturnedMessage;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Component
public class OrderEventPublisher {

    private static final Logger log =
            LoggerFactory.getLogger(OrderEventPublisher.class);

    private static final int BATCH_SIZE = 10;
    private static final int LEASE_SECONDS = 30;
    private static final int CONFIRM_TIMEOUT_SECONDS = 5;
    private static final int MAX_BACKOFF_SECONDS = 60;

    private final MongoTemplate mongoTemplate;
    private final RabbitTemplate rabbitTemplate;
    private final String queueName;

    public OrderEventPublisher(
            MongoTemplate mongoTemplate,
            RabbitTemplate rabbitTemplate,
            @Value("${app.order-events.queue:order-events}")
            String queueName
    ) {
        this.mongoTemplate = mongoTemplate;
        this.rabbitTemplate = rabbitTemplate;
        this.queueName = queueName;
    }

    @Scheduled(
            fixedDelayString =
                    "${app.order-events.publisher-delay-ms:2000}"
    )
    public void publishPendingEvents() {
        for (int i = 0; i < BATCH_SIZE; i++) {
            Order order = claimNextEvent();

            if (order == null) {
                return;
            }

            try {
                publish(order);
                markPublished(order);
            } catch (Exception exception) {
                scheduleRetry(order, exception);

                log.error(
                        "Failed to publish order event {} for order {}",
                        order.getEventId(),
                        order.getId(),
                        exception
                );
            }
        }
    }

    /**
     * Atomically claims one event.
     *
     * The lease lets another publisher recover an event if the
     * process crashes while its status is PUBLISHING.
     */
    private Order claimNextEvent() {
        Instant now = Instant.now();

        Criteria pendingAndDue = new Criteria().andOperator(
                Criteria.where("eventStatus").is("PENDING"),
                new Criteria().orOperator(
                        Criteria.where("eventNextAttemptAt").exists(false),
                        Criteria.where("eventNextAttemptAt").is(null),
                        Criteria.where("eventNextAttemptAt").lte(now)
                )
        );

        Criteria abandonedClaim = new Criteria().andOperator(
                Criteria.where("eventStatus").is("PUBLISHING"),
                Criteria.where("eventLeaseUntil").lte(now)
        );

        Query query = new Query(
                new Criteria().andOperator(
                        Criteria.where("status").is("COMPLETED"),
                        Criteria.where("eventId").exists(true),
                        new Criteria().orOperator(
                                pendingAndDue,
                                abandonedClaim
                        )
                )
        );

        query.with(Sort.by(Sort.Direction.ASC, "eventCreatedAt"));
        query.limit(1);

        Update update = new Update()
                .set("eventStatus", "PUBLISHING")
                .set(
                        "eventLeaseUntil",
                        now.plusSeconds(LEASE_SECONDS)
                )
                .inc("eventPublishAttempts", 1)
                .unset("eventNextAttemptAt");

        return mongoTemplate.findAndModify(
                query,
                update,
                org.springframework.data.mongodb.core.FindAndModifyOptions
                        .options()
                        .returnNew(true),
                Order.class
        );
    }

    private void publish(Order order) throws Exception {
        OrderCompletedEvent event = new OrderCompletedEvent(
                order.getEventId(),
                "order.completed",
                order.getEventCreatedAt(),
                order.getId(),
                order.getUserId(),
                order.getItems(),
                order.getStatus()
        );

        CorrelationData correlationData =
                new CorrelationData(order.getEventId());

        rabbitTemplate.convertAndSend(
                "",
                queueName,
                event,
                message -> {
                    message.getMessageProperties().setMessageId(
                            order.getEventId()
                    );

                    message.getMessageProperties().setContentType(
                            "application/json"
                    );

                    message.getMessageProperties().setDeliveryMode(
                            MessageDeliveryMode.PERSISTENT
                    );

                    return message;
                },
                correlationData
        );

        CorrelationData.Confirm confirm = correlationData
                .getFuture()
                .get(CONFIRM_TIMEOUT_SECONDS, TimeUnit.SECONDS);

        if (!confirm.isAck()) {
            throw new IllegalStateException(
                    "RabbitMQ rejected publication: " + confirm.getReason()
            );
        }

        ReturnedMessage returned = correlationData.getReturned();

        if (returned != null) {
            throw new IllegalStateException(
                    "RabbitMQ returned an unroutable event: "
                            + returned.getReplyText()
            );
        } 
    }
    private void markPublished(Order order) {
        Query query = new Query(
                new Criteria().andOperator(
                        Criteria.where("_id").is(order.getId()),
                        Criteria.where("eventId").is(order.getEventId()),
                        Criteria.where("eventStatus").is("PUBLISHING")
                )
        );

        Update update = new Update()
                .set("eventStatus", "PUBLISHED")
                .set("eventPublishedAt", Instant.now())
                .unset("eventLeaseUntil")
                .unset("eventNextAttemptAt")
                .unset("eventLastError");

        UpdateResult result = mongoTemplate.updateFirst(
                query,
                update,
                Order.class
        );

        if (result.getModifiedCount() == 0) {
            log.warn(
                    "Event {} was confirmed by RabbitMQ, but its MongoDB " +
                    "publication status was not updated. It may be retried.",
                    order.getEventId()
            );
        }
    }

    private void scheduleRetry(Order order, Exception exception) {
        int attempts = order.getEventPublishAttempts() == null
                ? 1
                : order.getEventPublishAttempts();

        int exponent = Math.min(Math.max(attempts - 1, 0), 6);
        long delaySeconds = Math.min(
                1L << exponent,
                MAX_BACKOFF_SECONDS
        );

        String error = exception.getMessage();

        if (error == null || error.isBlank()) {
            error = exception.getClass().getSimpleName();
        }

        // Keep the stored error reasonably small.
        if (error.length() > 500) {
            error = error.substring(0, 500);
        }

        Query query = new Query(
                new Criteria().andOperator(
                        Criteria.where("_id").is(order.getId()),
                        Criteria.where("eventId").is(order.getEventId()),
                        Criteria.where("eventStatus").is("PUBLISHING")
                )
        );

        Update update = new Update()
                .set("eventStatus", "PENDING")
                .set(
                        "eventNextAttemptAt",
                        Instant.now().plusSeconds(delaySeconds)
                )
                .set("eventLastError", error)
                .unset("eventLeaseUntil");

        mongoTemplate.updateFirst(query, update, Order.class);
    }
}
