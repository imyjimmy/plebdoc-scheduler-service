#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

case "${1:-up}" in
    "up"|"start")
        log_info "Starting appointments service..."
        docker-compose up -d
        log_success "Appointments service started!"
        echo ""
        echo "📊 Service URLs:"
        echo "   PHPMyAdmin: http://localhost:8081"
        echo "   MySQL: localhost:3306"
        echo ""
        echo "🔑 Database Credentials:"
        echo "   Database: easyappointments"
        echo "   Username: user"
        echo "   Password: password"
        ;;
    "down"|"stop")
        log_info "Stopping appointments service..."
        docker-compose down
        log_success "Service stopped"
        ;;
    "clean")
        log_info "Stopping and removing containers and volumes..."
        docker-compose down -v
        log_success "Cleanup complete"
        ;;
    "logs")
        docker-compose logs -f mysql
        ;;
    "rebuild")
        log_info "Rebuilding appointments service..."
        docker-compose down -v
        docker-compose up -d --build
        log_success "Rebuild complete"
        ;;
    *)
        echo "Usage: $0 [up|down|clean|logs|rebuild]"
        echo "  up     - Start the service (default)"
        echo "  down   - Stop the service"
        echo "  clean  - Stop and remove all data"
        echo "  logs   - Show MySQL logs"
        echo "  rebuild- Clean rebuild with fresh data"
        exit 1
        ;;
esac
