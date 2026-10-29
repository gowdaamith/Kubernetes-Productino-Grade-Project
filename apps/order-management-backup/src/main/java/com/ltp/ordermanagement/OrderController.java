package com.ltp.ordermanagement;

import com.ltp.ordermanagement.model.CartItem;
import com.ltp.ordermanagement.model.Order;
import com.ltp.ordermanagement.model.Product;
import com.ltp.ordermanagement.service.OrderService;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    // Add a product to the user's cart.
    @PostMapping("/{userId}/cart")
    public ResponseEntity<String> addToCart(
            @PathVariable Long userId,
            @RequestBody Product product
    ) {

        return ResponseEntity.ok(
                orderService.addToCart(userId, product)
        );
    }

    // Retrieve the cart subtotal.
    @GetMapping("/{userId}/cart/subtotal")
    public ResponseEntity<Double> getCartSubtotal(
            @PathVariable Long userId
    ) {

        return ResponseEntity.ok(
                orderService.getCartSubtotal(userId)
        );
    }

    // Retrieve shipping charges.
    @GetMapping("/{userId}/cart/shipping")
    public ResponseEntity<Double> getCartShippingTotal(
            @PathVariable Long userId
    ) {

        return ResponseEntity.ok(
                orderService.getCartShippingTotal(userId)
        );
    }

    // Retrieve the final cart total.
    @GetMapping("/{userId}/cart/total")
    public ResponseEntity<Double> getCartTotal(
            @PathVariable Long userId
    ) {

        return ResponseEntity.ok(
                orderService.getCartTotal(userId)
        );
    }

    // Purchase the cart.
    @PostMapping("/{userId}/purchase")
    public ResponseEntity<String> purchaseCart(
            @PathVariable Long userId
    ) {

        return ResponseEntity.ok(
                orderService.purchaseCart(userId)
        );
    }

    // Retrieve active cart items.
    @GetMapping("/{userId}/cart")
    public ResponseEntity<List<CartItem>> getCartItems(
            @PathVariable Long userId
    ) {

        List<CartItem> items = orderService.getUserCart(userId);

        if (items == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }

        return ResponseEntity.ok(items);
    }

    // Retrieve completed orders.
    @GetMapping("/{userId}/history")
    public ResponseEntity<List<Order>> getOrderHistory(
            @PathVariable Long userId
    ) {

        return ResponseEntity.ok(
                orderService.getOrderHistory(userId)
        );
    }
}
