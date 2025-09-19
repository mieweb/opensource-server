#!/bin/bash
# Script to install a specific Python runtime version
# Last Modified by Maxwell Klema on August 18th, 2025
# ----------------------------------------------------------

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <os> <python_version>"
    echo "Example: $0 debian 3.8.9"
    exit 1
fi

OS=$1
PYTHON_VERSION=$2
PYTHON_URL="https://www.python.org/ftp/python/$PYTHON_VERSION/Python-$PYTHON_VERSION.tgz"

# Function to install dependencies based on OS
install_dependencies() {
    case "${OS,,}" in
        debian)
            pct exec $CONTAINER_ID -- bash -c "sudo apt update -y && sudo apt install -y build-essential zlib1g-dev libncurses5-dev libgdbm-dev libnss3-dev libssl-dev libreadline-dev libffi-dev wget" > /dev/null 2>&1
            ;;
        rocky)
            pct exec $CONTAINER_ID -- bash -c "sudo dnf update -y && sudo dnf install -y gcc zlib-devel ncurses-devel gdbm-devel nss-devel openssl-devel readline-devel wget libffi-devel" > /dev/null 2>&1
            ;;
    esac
}

# Function to install Python
install_python() {
    echo "⏳ Installing Python $PYTHON_VERSION... This may take a while."
    pct exec "$CONTAINER_ID" -- bash -c "cd /usr/src && sudo wget $PYTHON_URL && sudo tar xzf Python-$PYTHON_VERSION.tgz && \
        cd Python-$PYTHON_VERSION && sudo ./configure --enable-optimizations && \
        sudo make -j$(nproc) && sudo make altinstall && \
        sudo ln -sfn /usr/local/bin/python${PYTHON_VERSION%.*} /usr/local/bin/python3 && \
        python3 -m ensurepip --upgrade && python3 -m pip install --upgrade pip"
    echo "Python $PYTHON_VERSION installed successfully." > /dev/null 2>&1
}

install_dependencies
install_python