# 🛡️ WiFi CSI Presence Detector

Detector de presencia humana mediante análisis de señal WiFi usando **ESP32** y **Channel State Information (CSI)**.

Un ESP32 transmite señales WiFi, otro las recibe. Cuando una persona se interpone entre ambos, su cuerpo perturba la señal. Este software analiza esas perturbaciones para detectar presencia, movimiento e incluso respiración.

```
ESP32 (TX)  ─────señal WiFi─────>  [PERSONA]  ─────>  ESP32 (RX)
                                    perturba          detecta cambio
                                    la señal          en CSI data
                                                           │
                                                           ▼
                                                  PC / Raspberry Pi
                                                  Dashboard Web
```

## 🚀 Inicio Rápido

### 1. Clonar el repositorio
```bash
git clone https://github.com/TU_USUARIO/wifi-csi-detector.git
cd wifi-csi-detector
```

### 2. Instalar dependencias
```bash
cd backend
pip install -r requirements.txt
```

### 3. Iniciar en modo demo (sin hardware)
```bash
python server.py
```

### 4. Abrir el dashboard
Navegá a **http://localhost:8080** en tu navegador.

El modo demo simula datos CSI realistas con ciclos de presencia/ausencia para que puedas explorar la plataforma antes de conectar el hardware.

---

## 📡 Modo Live (con ESP32)

### Hardware necesario
| Componente | Cantidad | Precio aprox |
|-----------|----------|-------------|
| ESP32 DevKit V1 | 2 | ~$5 USD c/u |
| Cables Micro-USB datos | 2 | ~$2 USD |

### Setup
1. Flashear firmware en los ESP32 → ver [firmware/README_firmware.md](firmware/README_firmware.md)
2. Conectar ESP32 RX a la PC por USB
3. Iniciar en modo live:
```bash
python server.py --mode live --serial-port /dev/ttyUSB0
```

---

## 🍓 Raspberry Pi

Para un sistema 24/7, usá una Raspberry Pi como hub:

```bash
sudo bash rpi/setup_rpi.sh
sudo systemctl start wifi-detector
```

Dashboard accesible desde cualquier dispositivo en la red local.

---

## 📁 Estructura del Proyecto

```
├── dashboard/              # Frontend web
│   ├── index.html          # Página principal
│   ├── styles.css          # Dark theme premium
│   └── app.js              # Lógica de visualización
│
├── backend/                # Backend Python
│   ├── server.py           # Servidor HTTP + WebSocket
│   ├── csi_processor.py    # Procesamiento de señal
│   ├── simulator.py        # Simulador de datos CSI
│   ├── serial_reader.py    # Lector serial ESP32
│   └── requirements.txt    # Dependencias
│
├── firmware/               # Firmware ESP32
│   ├── README_firmware.md  # Guía de flasheo
│   ├── flash_tx.sh         # Script flash transmisor
│   └── flash_rx.sh         # Script flash receptor
│
└── rpi/                    # Raspberry Pi
    ├── setup_rpi.sh        # Instalación automática
    └── wifi_detector.service
```

---

## 🔬 Cómo Funciona

### Channel State Information (CSI)
WiFi CSI mide la **amplitud y fase** de la señal WiFi en cada **subportadora** (64 para 20MHz). Cuando un cuerpo humano está en el camino de la señal:

1. **Absorbe** parte de la energía → la amplitud baja
2. **Refleja** la señal → crea interferencia → la fase cambia
3. **Se mueve** → las perturbaciones varían rápidamente

### Detección
- **Varianza baja** → espacio vacío (señal estable)
- **Varianza media** → persona presente pero quieta
- **Varianza alta** → persona en movimiento
- **Varianza periódica** → respiración detectable

### Stack Tecnológico
- **Frontend**: HTML5, CSS3, JavaScript, Chart.js
- **Backend**: Python, WebSockets, NumPy, SciPy
- **Hardware**: ESP32 (Espressif), ESP-CSI framework
- **Deployment**: Raspberry Pi 5, systemd

---

## ⚖️ Consideraciones Éticas

> **IMPORTANTE**: Esta tecnología puede detectar personas a través de paredes.

- ✅ Uso educativo y de investigación
- ✅ Monitoreo de tu propia casa con tu consentimiento
- ❌ Vigilancia sin consentimiento
- ❌ Espionaje de terceros

Usá esta herramienta de forma responsable y ética.

---

## 📚 Referencias

- [Espressif ESP-CSI](https://github.com/espressif/esp-csi)
- [ESP32-CSI-Tool](https://github.com/StevenMHernandez/ESP32-CSI-Tool)
- [CSIKit (Python)](https://github.com/Gi-z/CSIKit)
- [WiFi Sensing Papers — IEEE](https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=wifi%20sensing%20csi)

---

## 📄 Licencia

MIT License — Uso libre para educación e investigación.
