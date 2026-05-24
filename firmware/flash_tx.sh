#!/bin/bash
# Flash ESP32 Transmisor (TX) — csi_send
# Uso: ./flash_tx.sh [PUERTO]
# Ejemplo: ./flash_tx.sh /dev/ttyUSB0

set -e

PORT=${1:-$(ls /dev/tty.usb* 2>/dev/null | head -1 || ls /dev/ttyUSB* 2>/dev/null | head -1)}

if [ -z "$PORT" ]; then
    echo "❌ No se encontró puerto USB. Conectá el ESP32 e intentá de nuevo."
    echo "   Uso: ./flash_tx.sh /dev/ttyUSB0"
    exit 1
fi

echo "╔══════════════════════════════════════╗"
echo "║  📡 Flasheando ESP32 TX (Transmisor) ║"
echo "║  Puerto: $PORT"
echo "╚══════════════════════════════════════╝"

# Verificar ESP-IDF
if ! command -v idf.py &> /dev/null; then
    echo "❌ ESP-IDF no está instalado o no se ejecutó 'export.sh'"
    echo "   Ejecutá: . ~/esp/esp-idf/export.sh"
    exit 1
fi

# Clonar esp-csi si no existe
ESP_CSI_DIR="${HOME}/esp/esp-csi"
if [ ! -d "$ESP_CSI_DIR" ]; then
    echo "📥 Clonando esp-csi..."
    git clone https://github.com/espressif/esp-csi.git "$ESP_CSI_DIR"
fi

# Ir al directorio del transmisor
cd "$ESP_CSI_DIR/examples/get-started/csi_send"

echo "🔧 Configurando target..."
idf.py set-target esp32

echo "🔨 Compilando..."
idf.py build

echo "📤 Flasheando a $PORT..."
idf.py -p "$PORT" flash

echo ""
echo "✅ ¡ESP32 TX flasheado correctamente!"
echo "   Este ESP32 ahora transmite señales WiFi."
echo "   Solo necesita alimentación USB (no necesita estar conectado a la PC)."
echo ""
echo "   Para verificar: idf.py -p $PORT monitor"
