#-------------------------------------
# Stage 1: Build the  Go  application
#-------------------------------------

FROM golang:1.27-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /shipping-and-handling \
    .


#--------------------------------------
#Stage 2: minimal runtime image
#-------------------------------------

FROM alpine:3.22
RUN apk add --no-cache ca-certificates \
    && addgroup -S appgroup \
    && adduser -S -G appgroup appuser

WORKDIR /app
COPY --from=builder --chown=appuser:appgroup \
    /shipping-and-handling /app/shipping-and-handling

USER appuser:appgroup
EXPOSE 8080
ENTRYPOINT ["/app/shipping-and-handling"]


