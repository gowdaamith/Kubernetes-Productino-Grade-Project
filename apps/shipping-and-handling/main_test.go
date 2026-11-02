package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Test liveness endpoint returns HTTP 200.
func TestHandleLiveness(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health/live", nil)
	rec := httptest.NewRecorder()

	handleLiveness(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rec.Code)
	}

	if rec.Header().Get("Content-Type") != "application/json" {
		t.Errorf("expected application/json content type")
	}

	var response map[string]string

	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response["status"] != "alive" {
		t.Errorf("expected status alive, got %q", response["status"])
	}

	if response["service"] != "shipping-and-handling" {
		t.Errorf("unexpected service name: %q", response["service"])
	}
}

// Test liveness endpoint rejects unsupported methods.
func TestHandleLivenessMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/health/live", nil)
	rec := httptest.NewRecorder()

	handleLiveness(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected status 405, got %d", rec.Code)
	}
}

// Test readiness returns HTTP 503 when MongoDB is unavailable.
func TestHandleReadinessDatabaseUnavailable(t *testing.T) {
	oldClient := mongoClient
	oldCollection := productsCollection

	mongoClient = nil
	productsCollection = nil

	defer func() {
		mongoClient = oldClient
		productsCollection = oldCollection
	}()

	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	rec := httptest.NewRecorder()

	handleReadiness(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503, got %d", rec.Code)
	}

	if !strings.Contains(rec.Body.String(), "not ready") {
		t.Errorf("expected not ready response, got %q", rec.Body.String())
	}
}

// Test readiness rejects unsupported methods.
func TestHandleReadinessMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/health/ready", nil)
	rec := httptest.NewRecorder()

	handleReadiness(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected status 405, got %d", rec.Code)
	}
}

// Test shipping-fee endpoint rejects unsupported methods.
func TestHandleShippingFeeMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/shipping-fee?product_id=1", nil)
	rec := httptest.NewRecorder()

	handleShippingFee(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected status 405, got %d", rec.Code)
	}
}

// Test shipping-fee endpoint rejects a missing product ID.
func TestHandleShippingFeeMissingProductID(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/shipping-fee", nil)
	rec := httptest.NewRecorder()

	handleShippingFee(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", rec.Code)
	}

	if !strings.Contains(rec.Body.String(), "Missing product_id") {
		t.Errorf("unexpected response: %q", rec.Body.String())
	}
}

// Test shipping-fee endpoint rejects invalid product IDs.
func TestHandleShippingFeeInvalidProductID(t *testing.T) {
	testCases := []struct {
		name string
		id   string
	}{
		{name: "alphabetic ID", id: "abc"},
		{name: "decimal ID", id: "1.5"},
		{name: "special characters", id: "@!"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(
				http.MethodGet,
				"/shipping-fee?product_id="+tc.id,
				nil,
			)
			rec := httptest.NewRecorder()

			handleShippingFee(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("expected status 400, got %d", rec.Code)
			}
		})
	}
}

// Test shipping-fee endpoint rejects zero and negative product IDs.
func TestHandleShippingFeeNonPositiveProductID(t *testing.T) {
	testCases := []string{"0", "-1"}

	for _, id := range testCases {
		t.Run("product_id_"+id, func(t *testing.T) {
			req := httptest.NewRequest(
				http.MethodGet,
				"/shipping-fee?product_id="+id,
				nil,
			)
			rec := httptest.NewRecorder()

			handleShippingFee(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("expected status 400, got %d", rec.Code)
			}
		})
	}
}

// Test shipping explanation returns valid JSON.
func TestHandleShippingExplanation(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/shipping-explanation", nil)
	rec := httptest.NewRecorder()

	handleShippingExplanation(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	if rec.Header().Get("Content-Type") != "application/json" {
		t.Errorf("expected application/json content type")
	}

	var response map[string]string

	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	explanation := response["explanation"]

	if explanation == "" {
		t.Fatal("expected a non-empty shipping explanation")
	}

	if !strings.Contains(explanation, "Electronics") {
		t.Error("expected explanation to mention Electronics")
	}

	if !strings.Contains(explanation, "peak hours") {
		t.Error("expected explanation to mention peak hours")
	}
}

// Test shipping explanation rejects unsupported methods.
func TestHandleShippingExplanationMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/shipping-explanation", nil)
	rec := httptest.NewRecorder()

	handleShippingExplanation(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected status 405, got %d", rec.Code)
	}
}

// Test CORS middleware sets the expected headers.
func TestCORSMiddlewareHeaders(t *testing.T) {
	handler := corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/shipping-fee", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Error("expected wildcard allowed origin")
	}

	if rec.Header().Get("Access-Control-Allow-Methods") != "GET, OPTIONS" {
		t.Error("unexpected allowed methods")
	}

	if rec.Header().Get("Access-Control-Allow-Headers") != "Content-Type, Authorization" {
		t.Error("unexpected allowed headers")
	}

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}
}

// Test CORS middleware handles OPTIONS preflight requests.
func TestCORSMiddlewareOptions(t *testing.T) {
	nextHandlerCalled := false

	handler := corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		nextHandlerCalled = true
	})

	req := httptest.NewRequest(http.MethodOptions, "/shipping-fee", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}

	if nextHandlerCalled {
		t.Error("expected OPTIONS request to stop before the next handler")
	}

	if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Error("expected CORS headers on OPTIONS response")
	}
}

// Test shipping fee calculation for supported and default categories.
func TestCalculateShippingFee(t *testing.T) {
	testCases := []struct {
		category   string
		multiplier float64
	}{
		{"Electronics", 2.0},
		{"Office Supplies", 1.8},
		{"Home & Kitchen", 1.5},
		{"Groceries", 1.2},
		{"Fitness", 1.4},
		{"Outdoor", 1.4},
		{"Accessories", 1.0},
		{"Unknown", 1.0},
	}

	for _, tc := range testCases {
		t.Run(tc.category, func(t *testing.T) {
			before := time.Now()
			got := calculateShippingFee(tc.category)
			after := time.Now()

			baseFee := 5.0 * tc.multiplier

			// Determine whether the call occurred during peak hours.
			isPeak := func(hour int) bool {
				return hour >= 14 && hour <= 19
			}

			expectedBefore := baseFee
			if isPeak(before.Hour()) {
				expectedBefore += 3.0
			}

			expectedAfter := baseFee
			if isPeak(after.Hour()) {
				expectedAfter += 3.0
			}

			// Allow either result if the test crosses a peak-hour boundary.
			if got != expectedBefore && got != expectedAfter {
				t.Errorf(
					"category %q: expected fee %.2f or %.2f, got %.2f",
					tc.category,
					expectedBefore,
					expectedAfter,
					got,
				)
			}
		})
	}
}
