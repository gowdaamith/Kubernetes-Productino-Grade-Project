package com.ltp.ordermanagement.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

@Document(collection = "orders")
public class Order {

    @Id
    private String id;

    private Long userId;
    private List<CartItem> items;
    private String status;

    // Fields used to publish order events to RabbitMQ.
    private String eventId;
    private String eventStatus;
    private Instant eventCreatedAt;
    private Instant eventPublishedAt;
    private Instant eventLeaseUntil;
    private Instant eventNextAttemptAt;
    private Integer eventPublishAttempts;
    private String eventLastError;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public List<CartItem> getItems() {
        return items;
    }

    public void setItems(List<CartItem> items) {
        this.items = items;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getEventId() {
        return eventId;
    }

    public void setEventId(String eventId) {
        this.eventId = eventId;
    }

    public String getEventStatus() {
        return eventStatus;
    }

    public void setEventStatus(String eventStatus) {
        this.eventStatus = eventStatus;
    }

    public Instant getEventCreatedAt() {
        return eventCreatedAt;
    }

    public void setEventCreatedAt(Instant eventCreatedAt) {
        this.eventCreatedAt = eventCreatedAt;
    }

    public Instant getEventPublishedAt() {
        return eventPublishedAt;
    }

    public void setEventPublishedAt(Instant eventPublishedAt) {
        this.eventPublishedAt = eventPublishedAt;
    }

    public Instant getEventLeaseUntil() {
        return eventLeaseUntil;
    }

    public void setEventLeaseUntil(Instant eventLeaseUntil) {
        this.eventLeaseUntil = eventLeaseUntil;
    }

    public Instant getEventNextAttemptAt() {
        return eventNextAttemptAt;
    }

    public void setEventNextAttemptAt(Instant eventNextAttemptAt) {
        this.eventNextAttemptAt = eventNextAttemptAt;
    }

    public Integer getEventPublishAttempts() {
        return eventPublishAttempts;
    }

    public void setEventPublishAttempts(Integer eventPublishAttempts) {
        this.eventPublishAttempts = eventPublishAttempts;
    }

    public String getEventLastError() {
        return eventLastError;
    }

    public void setEventLastError(String eventLastError) {
        this.eventLastError = eventLastError;
    }
}
