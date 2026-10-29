package com.ltp.ordermanagement.repository;

import com.ltp.ordermanagement.model.Order;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface OrderRepository extends MongoRepository<Order, String> {

    // Find the user's active shopping cart.
    Optional<Order> findFirstByUserIdAndStatusOrderByIdDesc(
            Long userId,
            String status
    );

    // Retrieve the user's order history.
    List<Order> findByUserIdAndStatusOrderByIdDesc(
            Long userId,
            String status
    );
}
