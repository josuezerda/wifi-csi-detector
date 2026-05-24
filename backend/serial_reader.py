"""
Lector serial para ESP32 con datos CSI.
Lee datos del puerto serial USB y los parsea en formato utilizable.
"""

import serial
import serial.tools.list_ports
import threading
import time
import queue
from csi_processor import parse_csi_line


class SerialReader:
    """
    Lee datos CSI desde un ESP32 conectado por USB serial.
    Auto-detecta el puerto y parsea las líneas CSI_DATA.
    """

    BAUD_RATE = 921600
    COMMON_CHIPS = ["CP210", "CH340", "FTDI", "USB Serial", "ESP32", "Silicon Labs"]

    def __init__(self, port=None, baud_rate=None):
        """
        Args:
            port: Puerto serial (ej: '/dev/ttyUSB0'). Si es None, auto-detecta.
            baud_rate: Velocidad de baudios. Default: 921600
        """
        self.port = port
        self.baud_rate = baud_rate or self.BAUD_RATE
        self.serial_conn = None
        self.is_running = False
        self.data_queue = queue.Queue(maxsize=100)
        self.read_thread = None
        self.error = None

        # Estadísticas
        self.total_lines = 0
        self.csi_lines = 0
        self.errors = 0
        self.last_frame_time = None

    @staticmethod
    def list_ports():
        """Lista todos los puertos seriales disponibles."""
        ports = serial.tools.list_ports.comports()
        result = []
        for port in ports:
            result.append({
                "device": port.device,
                "description": port.description,
                "manufacturer": port.manufacturer or "Desconocido",
                "vid": port.vid,
                "pid": port.pid,
                "is_esp32": any(
                    chip.lower() in (port.description or "").lower()
                    for chip in SerialReader.COMMON_CHIPS
                ),
            })
        return result

    @staticmethod
    def auto_detect_port():
        """
        Auto-detecta el puerto del ESP32.
        Busca chips USB-Serial comunes (CP2102, CH340, FTDI).
        """
        ports = SerialReader.list_ports()

        # Primero buscar puertos que parecen ESP32
        for port in ports:
            if port["is_esp32"]:
                return port["device"]

        # Si no encuentra, retornar el primer puerto disponible
        if ports:
            return ports[0]["device"]

        return None

    def connect(self):
        """Conecta al puerto serial."""
        if self.port is None:
            self.port = self.auto_detect_port()

        if self.port is None:
            self.error = "No se encontró ningún puerto serial. ¿Está conectado el ESP32?"
            return False

        try:
            self.serial_conn = serial.Serial(
                port=self.port,
                baudrate=self.baud_rate,
                timeout=1,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
            )
            self.error = None
            return True
        except serial.SerialException as e:
            self.error = f"Error al conectar a {self.port}: {str(e)}"
            return False

    def disconnect(self):
        """Desconecta del puerto serial."""
        self.is_running = False
        if self.read_thread and self.read_thread.is_alive():
            self.read_thread.join(timeout=2)
        if self.serial_conn and self.serial_conn.is_open:
            self.serial_conn.close()
        self.serial_conn = None

    def start_reading(self):
        """Inicia la lectura en un hilo separado."""
        if not self.serial_conn or not self.serial_conn.is_open:
            if not self.connect():
                return False

        self.is_running = True
        self.read_thread = threading.Thread(target=self._read_loop, daemon=True)
        self.read_thread.start()
        return True

    def stop_reading(self):
        """Detiene la lectura."""
        self.is_running = False

    def _read_loop(self):
        """Loop de lectura del puerto serial (corre en hilo separado)."""
        while self.is_running:
            try:
                if not self.serial_conn or not self.serial_conn.is_open:
                    time.sleep(0.1)
                    continue

                line = self.serial_conn.readline()
                if not line:
                    continue

                self.total_lines += 1

                try:
                    decoded_line = line.decode("utf-8", errors="ignore").strip()
                except UnicodeDecodeError:
                    self.errors += 1
                    continue

                if not decoded_line:
                    continue

                # Parsear solo líneas CSI_DATA
                if decoded_line.startswith("CSI_DATA"):
                    parsed = parse_csi_line(decoded_line)
                    if parsed:
                        self.csi_lines += 1
                        self.last_frame_time = time.time()

                        # Poner en la cola (no bloquear si está llena)
                        try:
                            self.data_queue.put_nowait(parsed)
                        except queue.Full:
                            # Descartar frame más viejo
                            try:
                                self.data_queue.get_nowait()
                            except queue.Empty:
                                pass
                            self.data_queue.put_nowait(parsed)
                    else:
                        self.errors += 1

            except serial.SerialException as e:
                self.error = f"Error de lectura serial: {str(e)}"
                self.is_running = False
                break
            except Exception as e:
                self.errors += 1
                continue

    def read_frame(self):
        """
        Lee el siguiente frame CSI de la cola.

        Returns:
            dict con datos CSI parseados, o None si no hay datos
        """
        try:
            return self.data_queue.get_nowait()
        except queue.Empty:
            return None

    def get_status(self):
        """Retorna el estado actual del lector serial."""
        return {
            "connected": self.serial_conn is not None and self.serial_conn.is_open,
            "port": self.port,
            "baud_rate": self.baud_rate,
            "is_reading": self.is_running,
            "total_lines": self.total_lines,
            "csi_lines": self.csi_lines,
            "errors": self.errors,
            "error_message": self.error,
            "queue_size": self.data_queue.qsize(),
            "last_frame_time": self.last_frame_time,
            "available_ports": self.list_ports(),
        }
