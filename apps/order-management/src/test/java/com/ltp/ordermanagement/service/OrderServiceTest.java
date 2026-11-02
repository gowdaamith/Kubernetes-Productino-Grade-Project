package com.ltp.ordermanagement.service;

import com.ltp.ordermanagement.model.CartItem;
import com.ltp.ordermanagement.model.Order;
import com.ltp.ordermanagement.model.Product;
import com.ltp.ordermanagement.model.InventoryResponse;
import com.ltp.ordermanagement.repository.OrderRepository;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

    @Mock
    private RestTemplate restTemplate;

    @Mock
    private OrderRepository orderRepository;

    @InjectMocks
    private OrderService orderService;

    private final Long userId = 101L;

    @BeforeEach
    void setUp() {

        ReflectionTestUtils.setField(
                orderService,
                "productInventoryApiHost",
                "http://product-inventory"
        );

        ReflectionTestUtils.setField(
                orderService,
                "productCatalogApiHost",
                "http://product-catalog"
        );

        ReflectionTestUtils.setField(
                orderService,
                "shippingHandlingApiHost",
                "http://shipping-and-handling"
        );
    }

    // --------------------------------------------------
    // GROUP 1: CART SUBTOTAL
    // --------------------------------------------------

    @Test
    void shouldReturnZeroSubtotalWhenCartDoesNotExist() {

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(
                        userId,
                        "PENDING"
                ))
                .thenReturn(Optional.empty());

        double subtotal = orderService.getCartSubtotal(userId);

        assertEquals(0.0, subtotal);

        verify(orderRepository).findFirstByUserIdAndStatusOrderByIdDesc(
                userId,
                "PENDING"
        );
    }

    @Test
    void shouldCalculateCartSubtotalCorrectly() {

        Order order = new Order();

        order.setUserId(userId);
        order.setStatus("PENDING");

        order.setItems(List.of(
                new CartItem(1L, 2, "Laptop", "Laptop description", 500.0, "Electronics"),
                new CartItem(2L, 1, "Mouse", "Mouse description", 50.0, "Accessories")
        ));

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(
                        userId,
                        "PENDING"
                ))
                .thenReturn(Optional.of(order));

        double subtotal = orderService.getCartSubtotal(userId);

        // (500 x 2) + (50 x 1) = 1050
        assertEquals(1050.0, subtotal);
    }

    @Test
    void shouldReturnZeroSubtotalWhenCartItemsAreNull() {

        Order order = new Order();

        order.setUserId(userId);
        order.setStatus("PENDING");
        order.setItems(null);

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(
                        userId,
                        "PENDING"
                ))
                .thenReturn(Optional.of(order));

        assertEquals(0.0, orderService.getCartSubtotal(userId));
    }

    // --------------------------------------------------
    // GROUP 1: RETRIEVE CART
    // --------------------------------------------------

    @Test
    void shouldReturnNullWhenUserHasNoPendingCart() {

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(
                        userId,
                        "PENDING"
                ))
                .thenReturn(Optional.empty());

        List<CartItem> result = orderService.getUserCart(userId);

        assertNull(result);
    }

    @Test
    void shouldReturnCartItemsForUser() {

        List<CartItem> items = new ArrayList<>();

        items.add(
                new CartItem(
                        1L,
                        1,
                        "Laptop",
                        "Laptop description",
                        500.0,
                        "Electronics"
                )
        );

        Order order = new Order();

        order.setUserId(userId);
        order.setStatus("PENDING");
        order.setItems(items);

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(
                        userId,
                        "PENDING"
                ))
                .thenReturn(Optional.of(order));

        List<CartItem> result = orderService.getUserCart(userId);

        assertNotNull(result);
        assertEquals(1, result.size());
        assertEquals(1L, result.get(0).getProductId());
        assertEquals("Laptop", result.get(0).getName());
    }

    // --------------------------------------------------
    // GROUP 1: ORDER HISTORY
    // --------------------------------------------------

    @Test
    void shouldReturnCompletedOrderHistory() {

        Order firstOrder = new Order();
        firstOrder.setUserId(userId);
        firstOrder.setStatus("COMPLETED");

        Order secondOrder = new Order();
        secondOrder.setUserId(userId);
        secondOrder.setStatus("COMPLETED");

        List<Order> expectedOrders = List.of(
                firstOrder,
                secondOrder
        );

        when(orderRepository.findByUserIdAndStatusOrderByIdDesc(
                userId,
                "COMPLETED"
        )).thenReturn(expectedOrders);

        List<Order> result = orderService.getOrderHistory(userId);

        assertEquals(2, result.size());
        assertSame(firstOrder, result.get(0));
        assertSame(secondOrder, result.get(1));

        verify(orderRepository).findByUserIdAndStatusOrderByIdDesc(
                userId,
                "COMPLETED"
        );
    }


    // --------------------------------------------------
    // GROUP 2: ADD PRODUCT TO CART
    // --------------------------------------------------

    @Test
    void shouldAddProductToNewCart() {

        Product requestedProduct = new Product();
        requestedProduct.setId(1L);

        InventoryResponse inventory = new InventoryResponse();
        inventory.setId(1L);
        inventory.setQuantity(10);

        Product catalogProduct = new Product();
        catalogProduct.setId(1L);
        catalogProduct.setName("Laptop");
        catalogProduct.setDescription("Gaming laptop");
        catalogProduct.setPrice(1200.0);
        catalogProduct.setCategory("Electronics");

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(userId, "PENDING"))
                .thenReturn(Optional.empty());

        when(restTemplate.getForObject(
                "http://product-inventory/api/inventory/1",
                InventoryResponse.class
        )).thenReturn(inventory);

        when(restTemplate.getForObject(
                "http://product-catalog/api/products/1",
                Product.class
        )).thenReturn(catalogProduct);

        String result = orderService.addToCart(userId, requestedProduct);

        assertEquals("Product added to the cart", result);

        org.mockito.ArgumentCaptor<Order> captor =
                org.mockito.ArgumentCaptor.forClass(Order.class);

        verify(orderRepository).save(captor.capture());

        Order savedOrder = captor.getValue();

        assertEquals(userId, savedOrder.getUserId());
        assertEquals("PENDING", savedOrder.getStatus());
        assertEquals(1, savedOrder.getItems().size());

        CartItem savedItem = savedOrder.getItems().get(0);

        assertEquals(1L, savedItem.getProductId());
        assertEquals(1, savedItem.getQuantity());
        assertEquals("Laptop", savedItem.getName());
        assertEquals("Gaming laptop", savedItem.getDescription());
        assertEquals(1200.0, savedItem.getPrice());
        assertEquals("Electronics", savedItem.getCategory());
    }

    @Test
    void shouldAddProductToExistingCart() {

        Order existingOrder = new Order();
        existingOrder.setUserId(userId);
        existingOrder.setStatus("PENDING");
        existingOrder.setItems(new ArrayList<>());

        Product requestedProduct = new Product();
        requestedProduct.setId(2L);

        InventoryResponse inventory = new InventoryResponse();
        inventory.setQuantity(5);

        Product catalogProduct = new Product();
        catalogProduct.setId(2L);
        catalogProduct.setName("Keyboard");
        catalogProduct.setDescription("Mechanical keyboard");
        catalogProduct.setPrice(80.0);
        catalogProduct.setCategory("Accessories");

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(userId, "PENDING"))
                .thenReturn(Optional.of(existingOrder));

        when(restTemplate.getForObject(
                "http://product-inventory/api/inventory/2",
                InventoryResponse.class
        )).thenReturn(inventory);

        when(restTemplate.getForObject(
                "http://product-catalog/api/products/2",
                Product.class
        )).thenReturn(catalogProduct);

        String result = orderService.addToCart(userId, requestedProduct);

        assertEquals("Product added to the cart", result);
        assertEquals(1, existingOrder.getItems().size());
        assertEquals("Keyboard", existingOrder.getItems().get(0).getName());

        verify(orderRepository).save(existingOrder);
    }

    @Test
    void shouldRejectNullUserId() {

        Product product = new Product();
        product.setId(1L);

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> orderService.addToCart(null, product)
        );

        assertEquals(HttpStatus.BAD_REQUEST, exception.getStatusCode());

        verifyNoInteractions(orderRepository, restTemplate);
    }

    @Test
    void shouldRejectNonPositiveUserId() {

        Product product = new Product();
        product.setId(1L);

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> orderService.addToCart(0L, product)
        );

        assertEquals(HttpStatus.BAD_REQUEST, exception.getStatusCode());

        verifyNoInteractions(orderRepository, restTemplate);
    }

    @Test
    void shouldRejectNullProduct() {

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> orderService.addToCart(userId, null)
        );

        assertEquals(HttpStatus.BAD_REQUEST, exception.getStatusCode());

        verifyNoInteractions(orderRepository, restTemplate);
    }

    @Test
    void shouldRejectProductWithNullId() {

        Product product = new Product();

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> orderService.addToCart(userId, product)
        );

        assertEquals(HttpStatus.BAD_REQUEST, exception.getStatusCode());

        verifyNoInteractions(orderRepository, restTemplate);
    }

    @Test
    void shouldRejectProductWithNonPositiveId() {

        Product product = new Product();
        product.setId(0L);

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> orderService.addToCart(userId, product)
        );

        assertEquals(HttpStatus.BAD_REQUEST, exception.getStatusCode());

        verifyNoInteractions(orderRepository, restTemplate);
    }

    @Test
    void shouldRejectDuplicateProductInCart() {

        Order existingOrder = new Order();
        existingOrder.setUserId(userId);
        existingOrder.setStatus("PENDING");
        existingOrder.setItems(new ArrayList<>(List.of(
                new CartItem(
                        1L, 1, "Laptop", "Gaming laptop", 1200.0, "Electronics"
                )
        )));

        Product requestedProduct = new Product();
        requestedProduct.setId(1L);

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(userId, "PENDING"))
                .thenReturn(Optional.of(existingOrder));

        String result = orderService.addToCart(userId, requestedProduct);

        assertEquals("Product already exists in the cart", result);

        assertEquals(1, existingOrder.getItems().size());

        verifyNoInteractions(restTemplate);
        verify(orderRepository, never()).save(any(Order.class));
    }

    @Test
    void shouldRejectProductWhenInventoryIsZero() {

        Product requestedProduct = new Product();
        requestedProduct.setId(1L);

        InventoryResponse inventory = new InventoryResponse();
        inventory.setQuantity(0);

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(userId, "PENDING"))
                .thenReturn(Optional.empty());

        when(restTemplate.getForObject(
                "http://product-inventory/api/inventory/1",
                InventoryResponse.class
        )).thenReturn(inventory);

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> orderService.addToCart(userId, requestedProduct)
        );

        assertEquals(HttpStatus.CONFLICT, exception.getStatusCode());

        verify(orderRepository, never()).save(any(Order.class));

        verify(restTemplate, never()).getForObject(
                "http://product-catalog/api/products/1",
                Product.class
        );
    }

    @Test
    void shouldHandleInventoryServiceUnavailable() {

        Product requestedProduct = new Product();
        requestedProduct.setId(1L);

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(userId, "PENDING"))
                .thenReturn(Optional.empty());

        when(restTemplate.getForObject(
                "http://product-inventory/api/inventory/1",
                InventoryResponse.class
        )).thenThrow(new org.springframework.web.client.ResourceAccessException(
                "Inventory service unavailable"
        ));

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> orderService.addToCart(userId, requestedProduct)
        );

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, exception.getStatusCode());

        verify(orderRepository, never()).save(any(Order.class));
    }

    @Test
    void shouldHandleInventoryRecordNotFound() {

        Product requestedProduct = new Product();
        requestedProduct.setId(1L);

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(userId, "PENDING"))
                .thenReturn(Optional.empty());

        when(restTemplate.getForObject(
                "http://product-inventory/api/inventory/1",
                InventoryResponse.class
        )).thenThrow(new org.springframework.web.client.HttpClientErrorException(
                HttpStatus.NOT_FOUND
        ));

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> orderService.addToCart(userId, requestedProduct)
        );

        assertEquals(HttpStatus.NOT_FOUND, exception.getStatusCode());

        verify(orderRepository, never()).save(any(Order.class));
    }

    @Test
    void shouldHandleProductCatalogNotFound() {

        Product requestedProduct = new Product();
        requestedProduct.setId(1L);

        InventoryResponse inventory = new InventoryResponse();
        inventory.setQuantity(10);

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(userId, "PENDING"))
                .thenReturn(Optional.empty());

        when(restTemplate.getForObject(
                "http://product-inventory/api/inventory/1",
                InventoryResponse.class
        )).thenReturn(inventory);

        when(restTemplate.getForObject(
                "http://product-catalog/api/products/1",
                Product.class
        )).thenThrow(new org.springframework.web.client.HttpClientErrorException(
                HttpStatus.NOT_FOUND
        ));

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> orderService.addToCart(userId, requestedProduct)
        );

        assertEquals(HttpStatus.NOT_FOUND, exception.getStatusCode());

        verify(orderRepository, never()).save(any(Order.class));
    }

    @Test
    void shouldHandleProductCatalogUnavailable() {

        Product requestedProduct = new Product();
        requestedProduct.setId(1L);

        InventoryResponse inventory = new InventoryResponse();
        inventory.setQuantity(10);

        when(orderRepository
                .findFirstByUserIdAndStatusOrderByIdDesc(userId, "PENDING"))
                .thenReturn(Optional.empty());

        when(restTemplate.getForObject(
                "http://product-inventory/api/inventory/1",
                InventoryResponse.class
        )).thenReturn(inventory);

        when(restTemplate.getForObject(
                "http://product-catalog/api/products/1",
                Product.class
        )).thenThrow(new org.springframework.web.client.ResourceAccessException(
                "Product Catalog unavailable"
        ));

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> orderService.addToCart(userId, requestedProduct)
        );

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, exception.getStatusCode());

        verify(orderRepository, never()).save(any(Order.class));
    }

}
