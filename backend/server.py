"""
Servidor principal WiFi CSI Presence Detector.
Sirve el dashboard web y transmite datos CSI en tiempo real vía WebSocket.
"""

import asyncio
import json
import os
import sys
import signal
import argparse
from http.server import HTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from functools import partial

import websockets

from simulator import CSISimulator
from csi_processor import CSIProcessor
from serial_reader import SerialReader


# ─── Configuración ───────────────────────────────────────────

DEFAULT_HTTP_PORT = 8080
DEFAULT_WS_PORT = 8765
DEFAULT_MODE = "demo"  # "demo" o "live"
DASHBOARD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dashboard")
FRAME_RATE = 10  # Frames por segundo


# ─── Servidor HTTP (sirve archivos del dashboard) ───────────

class DashboardHandler(SimpleHTTPRequestHandler):
    """Sirve los archivos estáticos del dashboard."""

    def log_message(self, format, *args):
        """Silencia los logs HTTP para no llenar la consola."""
        pass

    def end_headers(self):
        """Agrega headers CORS para desarrollo."""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def start_http_server(port, directory):
    """Inicia el servidor HTTP en un hilo separado."""
    handler = partial(DashboardHandler, directory=directory)
    httpd = HTTPServer(("0.0.0.0", port), handler)
    thread = Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


# ─── Servidor WebSocket (streaming de datos CSI) ────────────

class WiFiDetectorServer:
    """
    Servidor principal que coordina:
    - Simulador CSI (modo demo)
    - Lector serial ESP32 (modo live)
    - Procesador de señal
    - Broadcast a clientes WebSocket
    """

    def __init__(self, mode=DEFAULT_MODE, ws_port=DEFAULT_WS_PORT):
        self.mode = mode
        self.ws_port = ws_port
        self.clients = set()

        # Componentes
        self.simulator = CSISimulator(sample_rate=FRAME_RATE)
        self.processor = CSIProcessor()
        self.serial_reader = SerialReader()

        # Estado
        self.is_running = False
        self.total_broadcasts = 0

        # Eventos
        self.event_log = []
        self.max_events = 50

    async def register(self, websocket):
        """Registra un nuevo cliente WebSocket."""
        self.clients.add(websocket)
        print(f"  📱 Cliente conectado ({len(self.clients)} total)")

        # Enviar estado inicial
        await websocket.send(json.dumps({
            "type": "init",
            "mode": self.mode,
            "config": self.processor.config,
            "serial_status": self.serial_reader.get_status(),
        }))

    async def unregister(self, websocket):
        """Desregistra un cliente WebSocket."""
        self.clients.discard(websocket)
        print(f"  📱 Cliente desconectado ({len(self.clients)} restantes)")

    async def handle_client(self, websocket):
        """Maneja la conexión de un cliente WebSocket."""
        await self.register(websocket)
        try:
            async for message in websocket:
                await self.handle_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self.unregister(websocket)

    async def handle_message(self, websocket, message):
        """Procesa mensajes entrantes de los clientes."""
        try:
            data = json.loads(message)
            msg_type = data.get("type", "")

            if msg_type == "config":
                # Actualizar configuración de detección
                self.processor.update_config(data.get("config", {}))
                print(f"  ⚙️  Configuración actualizada: {data.get('config', {})}")

            elif msg_type == "mode":
                # Cambiar modo demo/live
                new_mode = data.get("mode", self.mode)
                await self.switch_mode(new_mode)

            elif msg_type == "serial_connect":
                # Conectar al puerto serial
                port = data.get("port", None)
                await self.connect_serial(websocket, port)

            elif msg_type == "serial_disconnect":
                self.serial_reader.disconnect()
                await websocket.send(json.dumps({
                    "type": "serial_status",
                    "status": self.serial_reader.get_status(),
                }))

            elif msg_type == "list_ports":
                # Listar puertos seriales disponibles
                ports = SerialReader.list_ports()
                await websocket.send(json.dumps({
                    "type": "port_list",
                    "ports": ports,
                }))

            elif msg_type == "reset":
                # Reiniciar procesador
                self.processor.reset()
                self.event_log.clear()
                print("  🔄 Procesador reiniciado")

            elif msg_type == "force_state":
                # Forzar estado del simulador (para testing)
                state = data.get("state", "")
                self.simulator.force_state(state)

        except json.JSONDecodeError:
            pass

    async def switch_mode(self, new_mode):
        """Cambia entre modo demo y live."""
        if new_mode == self.mode:
            return

        self.mode = new_mode
        self.processor.reset()
        print(f"  🔀 Modo cambiado a: {new_mode}")

        if new_mode == "live":
            if not self.serial_reader.start_reading():
                print(f"  ❌ Error serial: {self.serial_reader.error}")
        else:
            self.serial_reader.stop_reading()

        # Notificar a todos los clientes
        for client in self.clients:
            try:
                await client.send(json.dumps({
                    "type": "mode_change",
                    "mode": new_mode,
                    "serial_status": self.serial_reader.get_status(),
                }))
            except websockets.exceptions.ConnectionClosed:
                pass

    async def connect_serial(self, websocket, port=None):
        """Conecta al puerto serial del ESP32."""
        if port:
            self.serial_reader.port = port
        
        success = self.serial_reader.connect()
        status = self.serial_reader.get_status()

        await websocket.send(json.dumps({
            "type": "serial_status",
            "status": status,
            "success": success,
        }))

        if success:
            print(f"  ✅ Conectado a {self.serial_reader.port}")
        else:
            print(f"  ❌ Error: {self.serial_reader.error}")

    async def broadcast_loop(self):
        """Loop principal: genera/lee datos CSI y los envía a los clientes."""
        self.is_running = True
        interval = 1.0 / FRAME_RATE
        last_presence = False

        print(f"  📡 Broadcasting a {FRAME_RATE} FPS...")

        while self.is_running:
            if not self.clients:
                await asyncio.sleep(interval)
                continue

            # Obtener frame según el modo
            raw_frame = None

            if self.mode == "demo":
                raw_frame = self.simulator.generate_frame()
            elif self.mode == "live":
                raw_frame = self.serial_reader.read_frame()

            if raw_frame is None:
                await asyncio.sleep(interval)
                continue

            # Procesar el frame
            processed = self.processor.process(raw_frame)

            # Detectar cambios de estado para el log de eventos
            current_presence = processed.get("presence", False)
            if current_presence != last_presence:
                event = {
                    "timestamp": processed.get("timestamp", 0),
                    "type": "presence_start" if current_presence else "presence_end",
                    "label": processed.get("presence_label", ""),
                    "variance": processed.get("variance", 0),
                }
                self.event_log.append(event)
                if len(self.event_log) > self.max_events:
                    self.event_log.pop(0)
                last_presence = current_presence

            # Agregar eventos al mensaje
            processed["events"] = self.event_log[-10:]  # Últimos 10 eventos

            # Broadcast a todos los clientes
            message = json.dumps(processed)
            disconnected = set()

            for client in self.clients:
                try:
                    await client.send(message)
                except websockets.exceptions.ConnectionClosed:
                    disconnected.add(client)

            self.clients -= disconnected
            self.total_broadcasts += 1

            await asyncio.sleep(interval)

    async def start(self):
        """Inicia el servidor WebSocket."""
        async with websockets.serve(
            self.handle_client,
            "0.0.0.0",
            self.ws_port,
            ping_interval=20,
            ping_timeout=10,
        ):
            print(f"  🔌 WebSocket en ws://0.0.0.0:{self.ws_port}")
            await self.broadcast_loop()


# ─── Main ────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="WiFi CSI Presence Detector - Servidor",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python server.py                    # Modo demo en puertos por defecto
  python server.py --mode live        # Modo live (requiere ESP32 conectado)
  python server.py --http-port 3000   # Puerto HTTP personalizado
  python server.py --serial-port /dev/ttyUSB0  # Puerto serial específico
        """,
    )

    parser.add_argument(
        "--mode", choices=["demo", "live"], default=DEFAULT_MODE,
        help="Modo de operación: 'demo' (simulador) o 'live' (ESP32 real)"
    )
    parser.add_argument(
        "--http-port", type=int, default=DEFAULT_HTTP_PORT,
        help=f"Puerto HTTP para el dashboard (default: {DEFAULT_HTTP_PORT})"
    )
    parser.add_argument(
        "--ws-port", type=int, default=DEFAULT_WS_PORT,
        help=f"Puerto WebSocket (default: {DEFAULT_WS_PORT})"
    )
    parser.add_argument(
        "--serial-port", type=str, default=None,
        help="Puerto serial del ESP32 (auto-detecta si no se especifica)"
    )
    parser.add_argument(
        "--baud-rate", type=int, default=921600,
        help="Baud rate del puerto serial (default: 921600)"
    )

    args = parser.parse_args()

    # Banner
    print()
    print("  ╔══════════════════════════════════════════════════╗")
    print("  ║   🛡️  WiFi CSI Presence Detector                ║")
    print("  ║   Detección de presencia humana por WiFi        ║")
    print("  ╚══════════════════════════════════════════════════╝")
    print()

    # Verificar que existe el directorio del dashboard
    dashboard_dir = os.path.abspath(DASHBOARD_DIR)
    if not os.path.exists(dashboard_dir):
        print(f"  ❌ No se encontró el dashboard en: {dashboard_dir}")
        print(f"     Asegurate de que la carpeta 'dashboard/' existe.")
        sys.exit(1)

    # Iniciar servidor HTTP
    httpd = start_http_server(args.http_port, dashboard_dir)
    print(f"  🌐 Dashboard en http://localhost:{args.http_port}")

    # Crear servidor WebSocket
    server = WiFiDetectorServer(mode=args.mode, ws_port=args.ws_port)

    # Configurar serial si modo live
    if args.serial_port:
        server.serial_reader.port = args.serial_port
    if args.baud_rate:
        server.serial_reader.baud_rate = args.baud_rate

    print(f"  📊 Modo: {'🎮 Demo (simulador)' if args.mode == 'demo' else '📡 Live (ESP32)'}")
    print()
    print(f"  ➡️  Abrí http://localhost:{args.http_port} en tu navegador")
    print()

    # Manejar Ctrl+C
    def signal_handler(sig, frame):
        print("\n  👋 Apagando servidor...")
        server.is_running = False
        httpd.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)

    # Iniciar
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        signal_handler(None, None)


if __name__ == "__main__":
    main()
