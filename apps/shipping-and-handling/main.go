package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ============================================================
// MongoDB Configuration
// ============================================================

var (
	mongoClient        *mongo.Client
	productsCollection *mongo.Collection
)

// ============================================================
// Product Model
// ============================================================

// Product represents a product stored in MongoDB.
type Product struct {
	ID          int     `bson:"id" json:"id"`
	Name        string  `bson:"name" json:"name"`
	Description string  `bson:"description" json:"description"`
	Price       float64 `bson:"price" json:"price"`
	Category    string  `bson:"category" json:"category"`
}

// ============================================================
// CORS Middleware
// ============================================================

// corsMiddleware allows cross-origin requests.
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set(
			"Access-Control-Allow-Methods",
			"GET, OPTIONS",
		)
		w.Header().Set(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization",
		)

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	}
}

// ============================================================
// MongoDB Connection and Initialization
// ============================================================

// connectAndInitializeDatabase connects to MongoDB.
//
// Sample products are inserted only when INITIALIZE_SAMPLE_DATA=true
// and the collection is empty.
//
// The normal application Deployment will not insert sample data.
// A Kubernetes initialization Job will perform that task.
func connectAndInitializeDatabase() error {
	mongoURI := os.Getenv("MONGO_URI")

	// Default to localhost for local development.
	// Kubernetes supplies mongodb://mongodb:27017.
	if mongoURI == "" {
		mongoURI = "mongodb://localhost:27017"
	}

	clientOptions := options.Client().
		ApplyURI(mongoURI).
		SetServerSelectionTimeout(5 * time.Second)

	// Limit the time spent connecting to MongoDB.
	ctx, cancel := context.WithTimeout(
		context.Background(),
		15*time.Second,
	)
	defer cancel()

	client, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		return fmt.Errorf(
			"create MongoDB connection: %w",
			err,
		)
	}

	// Verify that MongoDB is reachable.
	if err := client.Ping(ctx, nil); err != nil {
		disconnectCtx, disconnectCancel := context.WithTimeout(
			context.Background(),
			5*time.Second,
		)

		defer disconnectCancel()

		_ = client.Disconnect(disconnectCtx)

		return fmt.Errorf(
			"MongoDB is not reachable: %w",
			err,
		)
	}

	mongoClient = client

	// Use a separate logical database for Shipping and Handling.
	productsCollection = client.
		Database("shipping_handling").
		Collection("products")

	// Check whether sample products already exist.
	count, err := productsCollection.CountDocuments(
		ctx,
		bson.M{},
	)
	if err != nil {
		return fmt.Errorf(
			"count products in MongoDB: %w",
			err,
		)
	}

	initializeSampleData :=
		os.Getenv("INITIALIZE_SAMPLE_DATA") == "true"

	// Insert sample products only when explicitly enabled.
	if count == 0 && initializeSampleData {
		initialProducts := []interface{}{
			Product{
				ID:          1,
				Name:        "Wireless Bluetooth Headphones",
				Description: "High-quality sound and comfortable fit",
				Price:       59.99,
				Category:    "Electronics",
			},
			Product{
				ID:          2,
				Name:        "Vintage Leather Backpack",
				Description: "Stylish and durable backpack for everyday use",
				Price:       89.99,
				Category:    "Accessories",
			},
			Product{
				ID:          3,
				Name:        "Stainless Steel Water Bottle",
				Description: "Eco-friendly and leak-proof water bottle",
				Price:       19.99,
				Category:    "Home & Kitchen",
			},
			Product{
				ID:          4,
				Name:        "Organic Green Tea",
				Description: "A refreshing and healthy organic green tea",
				Price:       15.99,
				Category:    "Groceries",
			},
			Product{
				ID:          5,
				Name:        "Smartwatch Fitness Tracker",
				Description: "Track your fitness and stay connected on the go",
				Price:       199.99,
				Category:    "Electronics",
			},
			Product{
				ID:          6,
				Name:        "Professional Studio Microphone",
				Description: "Record high-quality audio with this studio microphone ",
				Price:       129.99,
				Category:    "Electronics",
			},
			Product{
				ID:          7,
				Name:        "Ergonomic Office Chair",
				Description: "Stay comfortable while working with this ergonomic chair",
				Price:       249.99,
				Category:    "Office Supplies",
			},
			Product{
				ID:          8,
				Name:        "LED Desk Lamp",
				Description: "Brighten your workspace with this energy-efficient LED lamp",
				Price:       39.99,
				Category:    "Home & Kitchen",
			},
			Product{
				ID:          9,
				Name:        "Gourmet Chocolate Box",
				Description: "Indulge in a variety of gourmet chocolates",
				Price:       29.99,
				Category:    "Groceries",
			},
			Product{
				ID:          10,
				Name:        "Yoga Mat with Carrying Strap",
				Description: "A non-slip yoga mat perfect for all types of yoga",
				Price:       49.99,
				Category:    "Fitness",
			},
			Product{
				ID:          11,
				Name:        "Insulated Camping Tent",
				Description: "A durable and insulated tent for your outdoor adventures",
				Price:       349.99,
				Category:    "Outdoor",
			},
			Product{
				ID:          12,
				Name:        "Bluetooth Speaker",
				Description: "Portable speaker with exceptional sound quality",
				Price:       99.99,
				Category:    "Electronics",
			},
		}

		_, err = productsCollection.InsertMany(
			ctx,
			initialProducts,
		)
		if err != nil {
			return fmt.Errorf(
				"insert initial products: %w",
				err,
			)
		}

		log.Println(
			"Inserted initial product data into shipping_handling.products",
		)
	} else if count > 0 {
		log.Printf(
			"Found %d existing products; skipping sample-data initialization",
			count,
		)
	} else {
		log.Println(
			"Sample-data initialization is disabled; no products were inserted",
		)
	}

	log.Println(
		"Connected to MongoDB database: shipping_handling",
	)

	return nil
}

// ============================================================
// Shipping Fee Calculation
// ============================================================

// calculateShippingFee calculates the shipping fee based on
// the product category and the current server time.
func calculateShippingFee(category string) float64 {
	baseFee := 5.0

	var categoryMultiplier float64

	timeOfDaySurcharge := 0.0

	peakHoursStart := 14
	peakHoursEnd := 19

	switch category {
	case "Electronics":
		categoryMultiplier = 2.0

	case "Office Supplies":
		categoryMultiplier = 1.8

	case "Home & Kitchen":
		categoryMultiplier = 1.5

	case "Groceries":
		categoryMultiplier = 1.2

	case "Fitness", "Outdoor":
		categoryMultiplier = 1.4

	default:
		categoryMultiplier = 1.0
	}

	// Apply a surcharge during peak hours.
	currentHour := time.Now().Hour()

	if currentHour >= peakHoursStart &&
		currentHour <= peakHoursEnd {
		timeOfDaySurcharge = 3.0
	}

	shippingFee :=
		(baseFee * categoryMultiplier) +
			timeOfDaySurcharge

	return shippingFee
}

// ============================================================
// API: GET /shipping-fee?product_id=<id>
// ============================================================

// handleShippingFee retrieves a product and calculates its
// shipping fee.
func handleShippingFee(
	w http.ResponseWriter,
	r *http.Request,
) {
	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method not allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	productIDString := r.URL.Query().Get("product_id")

	if productIDString == "" {
		http.Error(
			w,
			"Missing product_id query parameter",
			http.StatusBadRequest,
		)
		return
	}

	productID, err := strconv.Atoi(productIDString)
	if err != nil || productID <= 0 {
		http.Error(
			w,
			"Invalid product_id",
			http.StatusBadRequest,
		)
		return
	}

	ctx, cancel := context.WithTimeout(
		r.Context(),
		5*time.Second,
	)
	defer cancel()

	var product Product

	err = productsCollection.FindOne(
		ctx,
		bson.M{"id": productID},
	).Decode(&product)

	if err != nil {
		if err == mongo.ErrNoDocuments {
			http.Error(
				w,
				"Product not found",
				http.StatusNotFound,
			)
			return
		}

		log.Printf(
			"Failed to retrieve product %d: %v",
			productID,
			err,
		)

		http.Error(
			w,
			"Failed to retrieve product",
			http.StatusInternalServerError,
		)
		return
	}

	shippingFee := calculateShippingFee(product.Category)

	response := map[string]interface{}{
		"id":           product.ID,
		"name":         product.Name,
		"description":  product.Description,
		"price":        product.Price,
		"category":     product.Category,
		"shipping_fee": shippingFee,
	}

	w.Header().Set(
		"Content-Type",
		"application/json",
	)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf(
			"Failed to encode shipping-fee response: %v",
			err,
		)
	}
}

// ============================================================
// API: GET /shipping-explanation
// ============================================================

// handleShippingExplanation explains how shipping fees are
// calculated.
func handleShippingExplanation(
	w http.ResponseWriter,
	r *http.Request,
) {
	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method not allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	explanation := "Shipping fees are calculated using a base fee " +
		"of 5.00 multiplied by a category-specific multiplier. " +
		"Electronics use a multiplier of 2.0, Office Supplies 1.8, " +
		"Home & Kitchen 1.5, Groceries 1.2, Fitness and Outdoor 1.4, " +
		"and other categories 1.0. An additional 3.00 surcharge " +
		"applies during peak hours from 14:00 through 19:00, " +
		"using the server's local time."

	response := map[string]string{
		"explanation": explanation,
	}

	w.Header().Set(
		"Content-Type",
		"application/json",
	)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf(
			"Failed to encode shipping explanation: %v",
			err,
		)
	}
}

// ============================================================
// API: GET /all-shipping-fees
// ============================================================

// handleAllShippingFees retrieves all products and calculates
// a shipping fee for each product.
func handleAllShippingFees(
	w http.ResponseWriter,
	r *http.Request,
) {
	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method not allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	ctx, cancel := context.WithTimeout(
		r.Context(),
		10*time.Second,
	)
	defer cancel()

	cursor, err := productsCollection.Find(
		ctx,
		bson.M{},
	)
	if err != nil {
		log.Printf(
			"Failed to retrieve products: %v",
			err,
		)

		http.Error(
			w,
			"Failed to retrieve products",
			http.StatusInternalServerError,
		)
		return
	}

	defer cursor.Close(ctx)

	var products []Product

	if err := cursor.All(ctx, &products); err != nil {
		log.Printf(
			"Failed to decode products: %v",
			err,
		)

		http.Error(
			w,
			"Failed to decode products",
			http.StatusInternalServerError,
		)
		return
	}

	// Return an empty JSON array rather than null when no
	// products are present.
	response := make([]map[string]interface{}, 0, len(products))

	for _, product := range products {
		shippingFee := calculateShippingFee(product.Category)

		item := map[string]interface{}{
			"product_id":   product.ID,
			"shipping_fee": shippingFee,
			"price":        product.Price,
			"name":         product.Name,
			"description":  product.Description,
			"category":     product.Category,
		}

		response = append(response, item)
	}

	w.Header().Set(
		"Content-Type",
		"application/json",
	)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf(
			"Failed to encode all-shipping-fees response: %v",
			err,
		)
	}
}

// ============================================================
// Health Check: GET /health/live
// ============================================================

// handleLiveness indicates whether the application process
// is running.
func handleLiveness(
	w http.ResponseWriter,
	r *http.Request,
) {
	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method not allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	w.Header().Set(
		"Content-Type",
		"application/json",
	)

	_ = json.NewEncoder(w).Encode(
		map[string]string{
			"status":  "alive",
			"service": "shipping-and-handling",
		},
	)
}

// ============================================================
// Health Check: GET /health/ready
// ============================================================

// handleReadiness checks whether the application can access
// MongoDB and is ready to serve requests.
func handleReadiness(
	w http.ResponseWriter,
	r *http.Request,
) {
	if r.Method != http.MethodGet {
		http.Error(
			w,
			"Method not allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}

	if mongoClient == nil || productsCollection == nil {
		http.Error(
			w,
			`{"status":"not ready","database":"disconnected"}`,
			http.StatusServiceUnavailable,
		)
		return
	}

	ctx, cancel := context.WithTimeout(
		r.Context(),
		2*time.Second,
	)
	defer cancel()

	if err := mongoClient.Ping(ctx, nil); err != nil {
		log.Printf(
			"Readiness check failed: %v",
			err,
		)

		http.Error(
			w,
			`{"status":"not ready","database":"disconnected"}`,
			http.StatusServiceUnavailable,
		)
		return
	}

	w.Header().Set(
		"Content-Type",
		"application/json",
	)

	_ = json.NewEncoder(w).Encode(
		map[string]string{
			"status":   "ready",
			"database": "connected",
		},
	)
}

// ============================================================
// Application Entry Point
// ============================================================

func main() {
	// Connect to MongoDB before accepting requests.
	if err := connectAndInitializeDatabase(); err != nil {
		log.Fatalf(
			"Application startup failed: %v",
			err,
		)
	}

	// When running as a Kubernetes initialization Job,
	// exit after the database initialization step.
	if os.Getenv("INIT_ONLY") == "true" {
		log.Println(
			"Initialization completed; exiting",
		)

		disconnectCtx, cancel := context.WithTimeout(
			context.Background(),
			5*time.Second,
		)
		defer cancel()

		if mongoClient != nil {
			if err := mongoClient.Disconnect(disconnectCtx); err != nil {
				log.Printf(
					"MongoDB disconnect failed: %v",
					err,
				)
			}
		}

		return
	}

	port := os.Getenv("PORT")

	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()

	// Business API endpoints.
	mux.HandleFunc(
		"/shipping-fee",
		corsMiddleware(handleShippingFee),
	)

	mux.HandleFunc(
		"/shipping-explanation",
		corsMiddleware(handleShippingExplanation),
	)

	mux.HandleFunc(
		"/all-shipping-fees",
		corsMiddleware(handleAllShippingFees),
	)

	// Kubernetes health endpoints.
	mux.HandleFunc(
		"/health/live",
		handleLiveness,
	)

	mux.HandleFunc(
		"/health/ready",
		handleReadiness,
	)

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Handle Kubernetes SIGTERM and local Ctrl+C.
	signalCtx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	serverErrors := make(chan error, 1)

	go func() {
		log.Printf(
			"Shipping and Handling server listening on port %s",
			port,
		)

		serverErrors <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		if err != nil && err != http.ErrServerClosed {
			log.Printf(
				"HTTP server failed: %v",
				err,
			)
		}

	case <-signalCtx.Done():
		log.Println(
			"Shutdown signal received; shutting down HTTP server",
		)

		shutdownCtx, cancel := context.WithTimeout(
			context.Background(),
			10*time.Second,
		)
		defer cancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf(
				"Graceful HTTP shutdown failed: %v",
				err,
			)

			if closeErr := server.Close(); closeErr != nil {
				log.Printf(
					"Forced HTTP server close failed: %v",
					closeErr,
				)
			}
		}
	}

	// Disconnect from MongoDB during application shutdown.
	if mongoClient != nil {
		disconnectCtx, cancel := context.WithTimeout(
			context.Background(),
			5*time.Second,
		)
		defer cancel()

		if err := mongoClient.Disconnect(disconnectCtx); err != nil {
			log.Printf(
				"MongoDB disconnect failed: %v",
				err,
			)
		} else {
			log.Println(
				"Disconnected from MongoDB",
			)
		}
	}
}
