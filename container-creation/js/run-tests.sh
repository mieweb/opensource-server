#!/bin/bash

# Test runner script for container-creation JavaScript modules
# This script provides an easy way to run different types of tests

set -e

echo "🧪 Container Creation JS Module Test Runner"
echo "=========================================="

# Change to the JS directory
cd "$(dirname "$0")"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Parse command line arguments
case "${1:-all}" in
    "all"|"")
        echo "🚀 Running all tests..."
        npm test
        ;;
    "coverage")
        echo "📊 Running tests with coverage report..."
        npm run test:coverage
        ;;
    "watch")
        echo "👀 Running tests in watch mode..."
        npm run test:watch
        ;;
    "repo")
        echo "🔗 Running repository authentication tests..."
        npx jest authenticateRepo.test.js
        ;;
    "user")
        echo "👤 Running user authentication tests..."
        npx jest authenticateUser.test.js
        ;;
    "runner")
        echo "⚙️  Running CLI runner tests..."
        npx jest runner.test.js
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [test-type]"
        echo ""
        echo "Test types:"
        echo "  all        Run all tests (default)"
        echo "  coverage   Run tests with coverage report"
        echo "  watch      Run tests in watch mode"
        echo "  repo       Run repository authentication tests only"
        echo "  user       Run user authentication tests only"
        echo "  runner     Run CLI runner tests only"
        echo "  help       Show this help message"
        exit 0
        ;;
    *)
        echo "❌ Unknown test type: $1"
        echo "Run '$0 help' for available options"
        exit 1
        ;;
esac

echo ""
echo "✅ Test run completed!"