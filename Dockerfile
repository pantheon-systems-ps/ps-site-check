FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /site-check .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /site-check /site-check
EXPOSE 8080
ENTRYPOINT ["/site-check"]
