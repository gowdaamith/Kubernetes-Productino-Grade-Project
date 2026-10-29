package com.ltp.ordermanagement.service;

import com.ltp.ordermanagement.model.CartItem;
import com.ltp.ordermanagement.model.InventoryResponse;
import com.ltp.ordermanagement.model.Order;
import com.ltp.ordermanagement.model.Product;
import com.ltp.ordermanagement.repository.OrderRepository;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

@Service
public class OrderService {

    private static final String PENDING = "PENDING";
    private static final String PROCESSING = "PROCESSING";
    private static final String COMPLETED = "COMPLETED";
    private static final String REQUIRES_REVIEW = "REQUIRES_REVIEW";

    private final RestTemplate restTemplate;
    private final OrderRepository orderRepository;

    @Value("${product.inventory.api.host}")
    private String productInventoryApiHost;

    @Value("${product.catalog.api.host}")
    private String productCatalogApiHost;

    @Value("${shipping.handling.api.host}")
    private String shippingHandlingApiHost;
    public OrderService(
            RestTemplate restTemplate,
            OrderRepository orderRepository
    ) {
        this.restTemplate = restTemplate;
        this.orderRepository = orderRepository;
    }

    // --------------------------------------------------
    // Retrieve the user's active cart
    // --------------------------------------------------

    private Order findPendingCart(Long userId) {

        return orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(
                        userId,
                        PENDING
                )
                .orElse(null);
    }

    // --------------------------------------------------
    // Add a product to the cart
    // --------------------------------------------------

    public String addToCart(Long userId, Product product) {

        if (userId == null || userId <= 0 ||
                product == null ||
                product.getId() == null ||
                product.getId() <= 0) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Valid user ID and product ID are required"
            );
        }

        Order order = findPendingCart(userId);

        if (order == null) {

            order = new Order();
            order.setUserId(userId);
            order.setItems(new ArrayList<>());
            order.setStatus(PENDING);
        }

        if (order.getItems() == null) {
            order.setItems(new ArrayList<>());
        }

        Long productId = product.getId();

        boolean alreadyExists = order.getItems()
                .stream()
                .anyMatch(item ->
                        Objects.equals(
                                item.getProductId(),
                                productId
                        )
                );

        if (alreadyExists) {
            return "Product already exists in the cart";
        }

        // Check product availability.
        InventoryResponse inventory = fetchInventory(productId);

        if (inventory.getQuantity() == null ||
                inventory.getQuantity() <= 0) {

            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Product is out of stock"
            );
        }

        // Retrieve authoritative product details.
        Product details = fetchProduct(productId);

        CartItem cartItem = new CartItem(
                details.getId(),
                1,
                details.getName(),
                details.getDescription(),
                details.getPrice(),
                details.getCategory()
        );

        order.getItems().add(cartItem);

        orderRepository.save(order);

        return "Product added to the cart";
    }

    // --------------------------------------------------
    // Retrieve product information
    // --------------------------------------------------

    private Product fetchProduct(Long productId) {

        try {

            Product product = restTemplate.getForObject(
                    productCatalogApiHost + "/api/products/" + productId,
                    Product.class
            );

            if (product == null || product.getId() == null) {

                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "Invalid response from Product Catalog"
                );
            }

            return product;

        } catch (HttpStatusCodeException exception) {

            if (exception.getStatusCode().value() == 404) {

                throw new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "Product not found"
                );
            }

            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Product Catalog request failed",
                    exception
            );

        } catch (RestClientException exception) {

            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "Product Catalog is unavailable",
                    exception
            );
        }
    }

    // --------------------------------------------------
    // Retrieve inventory information
    // --------------------------------------------------

    private InventoryResponse fetchInventory(Long productId) {

        try {

            InventoryResponse inventory = restTemplate.getForObject(
                    productInventoryApiHost + "/api/inventory/" + productId,
                    InventoryResponse.class
            );

            if (inventory == null ||
                    inventory.getQuantity() == null) {

                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "Invalid inventory response"
                );
            }

            return inventory;

        } catch (HttpStatusCodeException exception) {

            if (exception.getStatusCode().value() == 404) {

                throw new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "Inventory record not found"
                );
            }

            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Inventory request failed",
                    exception
            );

        } catch (RestClientException exception) {

            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "Product Inventory is unavailable",
                    exception
            );
        }
    }

    // --------------------------------------------------
    // Calculate subtotal
    // --------------------------------------------------

    public double getCartSubtotal(Long userId) {

        Order order = findPendingCart(userId);

        if (order == null || order.getItems() == null) {
            return 0.0;
        }

        double subtotal = 0.0;

        for (CartItem item : order.getItems()) {

            // Use the price stored in the cart.
            subtotal += item.getPrice() * item.getQuantity();
        }

        return subtotal;
    }

    // --------------------------------------------------
    // Calculate shipping charges
    // --------------------------------------------------

    public double getCartShippingTotal(Long userId) {

        Order order = findPendingCart(userId);

        if (order == null || order.getItems() == null) {
            return 0.0;
        }

        double shippingTotal = 0.0;

        for (CartItem item : order.getItems()) {

            try {

                Product shippingResponse =
                        restTemplate.getForObject(
                                shippingHandlingApiHost
                                        + "/shipping-fee?product_id="
                                        + item.getProductId(),
                                Product.class
                        );

                if (shippingResponse == null) {

                    throw new ResponseStatusException(
                            HttpStatus.BAD_GATEWAY,
                            "Invalid shipping response"
                    );
                }

                shippingTotal +=
                        shippingResponse.getShippingFee()
                                * item.getQuantity();

            } catch (RestClientException exception) {

                throw new ResponseStatusException(
                        HttpStatus.SERVICE_UNAVAILABLE,
                        "Shipping service request failed",
                        exception
                );
            }
        }

        return shippingTotal;
    }

    // --------------------------------------------------
    // Calculate cart total
    // --------------------------------------------------

    public double getCartTotal(Long userId) {

        return getCartSubtotal(userId)
                + getCartShippingTotal(userId);
    }

    // --------------------------------------------------
    // Purchase cart
    // --------------------------------------------------

    public String purchaseCart(Long userId) {

        Order order = findPendingCart(userId);

        if (order == null ||
                order.getItems() == null ||
                order.getItems().isEmpty()) {

            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "No items in the cart"
            );
        }

        // Pre-check inventory before starting the purchase.
        // This reduces avoidable failures but does not reserve stock.
        for (CartItem item : order.getItems()) {

            if (item.getQuantity() != 1) {

                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "Only quantity 1 is supported currently"
                );
            }

            InventoryResponse inventory =
                    fetchInventory(item.getProductId());

            if (inventory.getQuantity() < 1) {

                throw new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "Insufficient inventory for product "
                                + item.getProductId()
                );
            }
        }

        // Record the purchase attempt before changing inventory.
        order.setStatus(PROCESSING);
        orderRepository.save(order);

        try {

            for (CartItem item : order.getItems()) {

                // Existing Inventory API reduces stock by 1.
                restTemplate.postForObject(
                        productInventoryApiHost
                                + "/api/order/"
                                + item.getProductId(),
                        null,
                        InventoryResponse.class
                );
            }

        } catch (RestClientException exception) {

            // Some stock updates might already have succeeded.
            // Do not automatically retry this purchase.
            order.setStatus(REQUIRES_REVIEW);
            orderRepository.save(order);

            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Purchase requires review: inventory updates "
                            + "may have partially succeeded",
                    exception
            );
        }

        // Preserve the purchased items in the completed order.
        order.setStatus(COMPLETED);
        orderRepository.save(order);

        return "Purchase completed successfully";
    }

    // --------------------------------------------------
    // Retrieve active cart items
    // --------------------------------------------------

    public List<CartItem> getUserCart(Long userId) {

        Order order = findPendingCart(userId);

        if (order == null) {
            return null;
        }

        return order.getItems();
    }

    // --------------------------------------------------
    // Retrieve completed order history
    // --------------------------------------------------

    public List<Order> getOrderHistory(Long userId) {

        return orderRepository.findByUserIdAndStatusOrderByIdDesc(
                userId,
                COMPLETED
        );
    }
}
