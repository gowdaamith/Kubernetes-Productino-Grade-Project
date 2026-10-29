package com.ltp.ordermanagement.model;

import java.time.Instant;
import java.util.List;

public record OrderCompletedEvent(
        String eventId,
        String eventType,
        Instant occurredAt,
        String orderId,
        Long userId,
        List<CartItem> items,
        String status
) {
}
