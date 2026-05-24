# 🔧 Firmware ESP32 — Guía de Flasheo

Esta guía explica cómo preparar los dos ESP32 para el detector de presencia WiFi CSI.

## Requisitos

### Software
- **ESP-IDF v5.0+** (framework de desarrollo de Espressif)
- **Python 3.8+**
- **Git**

### Hardware
- 2x ESP32 DevKit V1 (WROOM-32)
- 2x Cables Micro-USB de datos
- PC con Mac/Linux/Windows

---

## 1. Instalar ESP-IDF

### macOS / Linux
```bash
# Clonar ESP-IDF
mkdir -p ~/esp
cd ~/esp
git clone -b v5.2.1 --recursive https://github.com/espressif/esp-idf.git

# Instalar herramientas
cd esp-idf
./install.sh esp32

# Activar entorno (hacer esto cada vez que abras terminal)
. ~/esp/esp-idf/export.sh
```

### Verificar instalación
```bash
idf.py --version
# Debería mostrar: ESP-IDF v5.2.1
```

---

## 2. Clonar el repositorio ESP-CSI

```bash
cd ~/esp
git clone https://github.com/espressif/esp-csi.git
cd esp-csi
```

---

## 3. Flashear ESP32 #1 — TRANSMISOR (TX)

Este ESP32 envía señales WiFi continuamente.

```bash
cd ~/esp/esp-csi/examples/get-started/csi_send

# Configurar para ESP32 estándar
idf.py set-target esp32

# Compilar
idf.py build

# Conectar ESP32 TX por USB y flashear
# Reemplazar PORT con tu puerto (ej: /dev/tty.usbserial-0001)
idf.py -p PORT flash

# Verificar que funciona
idf.py -p PORT monitor
```

### ¿Cómo encuentro el puerto?
```bash
# macOS
ls /dev/tty.usb*

# Linux
ls /dev/ttyUSB*

# Si no aparece, instalar driver CH340:
# https://www.wch-ic.com/downloads/CH341SER_MAC_ZIP.html
```

---

## 4. Flashear ESP32 #2 — RECEPTOR (RX)

Este ESP32 recibe las señales y reporta datos CSI.

```bash
cd ~/esp/esp-csi/examples/get-started/csi_recv

# Configurar
idf.py set-target esp32

# Compilar
idf.py build

# Conectar ESP32 RX por USB y flashear
idf.py -p PORT flash

# Verificar — deberías ver líneas "CSI_DATA,..."
idf.py -p PORT monitor
```

### Salida esperada del receptor:
```
CSI_DATA,xx:xx:xx:xx:xx:xx,-55,11,0,0,20,0,0,...,[12,5,14,3,...]
CSI_DATA,xx:xx:xx:xx:xx:xx,-54,11,0,0,20,0,0,...,[13,4,15,2,...]
```

Si ves esas líneas, ¡está funcionando! 🎉

---

## 5. Conectar al Backend

Una vez flasheados ambos ESP32:

1. Conectar el ESP32 **RX** a tu PC/Raspberry Pi por USB
2. El ESP32 **TX** solo necesita alimentación (USB a cargador o powerbank)
3. Iniciar el servidor:

```bash
cd backend
python server.py --mode live --serial-port /dev/ttyUSB0
```

4. Abrir el dashboard en el navegador

---

## Troubleshooting

| Problema | Solución |
|----------|----------|
| No aparece el puerto USB | Instalar driver CH340/CP2102 |
| "Permission denied" en el puerto | `sudo chmod 666 /dev/ttyUSB0` o agregar usuario al grupo `dialout` |
| No se ve CSI_DATA | Verificar que ambos ESP32 estén en el mismo canal WiFi |
| Datos corruptos | Verificar baud rate = 921600 |
| Error de compilación | Verificar versión de ESP-IDF con `idf.py --version` |

---

## Scripts Automatizados

Usá los scripts `flash_tx.sh` y `flash_rx.sh` para automatizar el proceso:

```bash
# Flashear transmisor
./flash_tx.sh /dev/ttyUSB0

# Flashear receptor
./flash_rx.sh /dev/ttyUSB1
```
