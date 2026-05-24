#!/usr/bin/env python3
"""
Control Home — Raspberry Pi 5 Service
Conecta a cámaras Dahua, detecta rostros y uso de celular.
Envía eventos al dashboard web vía API.

Requisitos:
  pip install opencv-python face_recognition numpy requests pillow

Uso:
  python3 main.py
"""

import cv2
import time
import json
import os
import sys
import threading
import signal
from datetime import datetime
from typing import Optional
import requests
import numpy as np

# ── Configuración ─────────────────────────────────────────────
API_URL = os.getenv("CONTROL_HOME_API_URL", "https://control-home.vercel.app")
API_SECRET = os.getenv("CONTROL_HOME_SECRET", "ch_secret_2026")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

DETECTION_INTERVAL = 2  # segundos entre cada análisis
FACE_TOLERANCE = 0.55   # menor = más estricto
PHONE_SESSION_TIMEOUT = 120  # segundos sin ver celular para cerrar sesión

running = True

def signal_handler(sig, frame):
    global running
    print("\n🛑 Deteniendo servicio...")
    running = False

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


# ── Carga de datos desde Supabase ─────────────────────────────
def supabase_headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def load_cameras():
    """Carga las cámaras configuradas desde Supabase."""
    try:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/home_cameras?is_active=eq.true",
            headers=supabase_headers()
        )
        return res.json() if res.status_code == 200 else []
    except Exception as e:
        print(f"❌ Error cargando cámaras: {e}")
        return []


def load_person_photos(person_id):
    """Carga las fotos de una persona desde Supabase."""
    try:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/home_person_photos?person_id=eq.{person_id}",
            headers=supabase_headers()
        )
        return res.json() if res.status_code == 200 else []
    except Exception as e:
        print(f"  ⚠️  Error cargando fotos de persona: {e}")
        return []


def download_photo(storage_path):
    """Descarga una foto desde Supabase Storage y la devuelve como imagen numpy."""
    try:
        url = f"{SUPABASE_URL}/storage/v1/object/face-photos/{storage_path}"
        res = requests.get(url, headers=supabase_headers())
        if res.status_code == 200:
            img_array = np.frombuffer(res.content, dtype=np.uint8)
            img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
            return img
        else:
            print(f"  ⚠️  Error descargando foto ({res.status_code}): {storage_path}")
            return None
    except Exception as e:
        print(f"  ⚠️  Error descargando foto: {e}")
        return None


def sync_face_encodings():
    """
    Descarga fotos de cada persona, genera face encodings con face_recognition,
    y actualiza el campo face_encodings en Supabase.
    """
    try:
        import face_recognition
    except ImportError:
        print("  ⚠️  face_recognition no instalado. No se pueden generar encodings.")
        return

    print("🧬 Sincronizando face encodings...")
    
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/home_persons?is_active=eq.true",
        headers=supabase_headers()
    )
    persons = res.json() if res.status_code == 200 else []
    
    for person in persons:
        pid = person["id"]
        name = person["name"]
        photos = load_person_photos(pid)
        
        if not photos:
            continue
        
        # Generar encodings de cada foto
        new_encodings = []
        for photo in photos:
            img = download_photo(photo["storage_path"])
            if img is None:
                continue
            
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            locations = face_recognition.face_locations(rgb, model="hog")
            encodings = face_recognition.face_encodings(rgb, locations)
            
            if encodings:
                new_encodings.append(encodings[0].tolist())
                print(f"  ✅ {name}: encoding generado desde {photo.get('original_name', 'foto')}")
            else:
                print(f"  ⚠️  {name}: no se detectó rostro en {photo.get('original_name', 'foto')}")
        
        if new_encodings:
            # Comparar con encodings existentes para evitar updates innecesarios
            existing = person.get("face_encodings", [])
            if isinstance(existing, str):
                existing = json.loads(existing)
            
            if len(existing) != len(new_encodings):
                # Actualizar en Supabase
                update_headers = {**supabase_headers(), "Content-Type": "application/json", "Prefer": "return=minimal"}
                requests.patch(
                    f"{SUPABASE_URL}/rest/v1/home_persons?id=eq.{pid}",
                    headers=update_headers,
                    json={"face_encodings": new_encodings}
                )
                print(f"  🧬 {name}: {len(new_encodings)} encoding(s) guardados")


def load_persons():
    """Carga personas autorizadas con sus encodings faciales."""
    try:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/home_persons?is_active=eq.true",
            headers=supabase_headers()
        )
        persons = res.json() if res.status_code == 200 else []
        
        known_encodings = []
        known_names = []
        known_ids = []
        
        for p in persons:
            encodings = p.get("face_encodings", [])
            if isinstance(encodings, str):
                encodings = json.loads(encodings)
            for enc in encodings:
                known_encodings.append(np.array(enc))
                known_names.append(p["name"])
                known_ids.append(p["id"])
        
        return persons, known_encodings, known_names, known_ids
    except Exception as e:
        print(f"❌ Error cargando personas: {e}")
        return [], [], [], []


# ── Envío de eventos ──────────────────────────────────────────
def send_event(event_type, person_name, camera_name, confidence=None, 
               person_id=None, is_known=True, photo_path=None):
    """Envía un evento de presencia al dashboard."""
    try:
        headers = {
            "apikey": SUPABASE_KEY, 
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        
        payload = {
            "event_type": event_type,
            "person_name": person_name,
            "camera_name": camera_name,
            "confidence": confidence,
            "person_id": person_id,
            "is_known": is_known,
            "event_time": datetime.now().isoformat()
        }
        
        res = requests.post(
            f"{SUPABASE_URL}/rest/v1/home_presence_events",
            headers=headers,
            json=payload
        )
        
        emoji = "🟢" if is_known else "🔴"
        print(f"  {emoji} Evento: {event_type} | {person_name} | {camera_name} | conf: {confidence:.0%}" if confidence else
              f"  {emoji} Evento: {event_type} | {person_name} | {camera_name}")
              
    except Exception as e:
        print(f"  ❌ Error enviando evento: {e}")


# ── Alertas WhatsApp ──────────────────────────────────────────
_alert_config = None
_alert_config_last_load = 0

def get_alert_config():
    """Carga la configuración de alertas desde Supabase (con cache de 5 min)."""
    global _alert_config, _alert_config_last_load
    now = time.time()
    if _alert_config and now - _alert_config_last_load < 300:
        return _alert_config
    
    try:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/home_config?id=eq.main",
            headers=supabase_headers()
        )
        data = res.json()
        _alert_config = data[0] if data else {}
        _alert_config_last_load = now
    except Exception:
        _alert_config = {}
    
    return _alert_config


def send_whatsapp_alert(message):
    """Envía alerta WhatsApp directo via Meta Cloud API."""
    # Check if notifications are enabled in config
    try:
        config = get_alert_config()
        if not config.get("notifications_enabled", True):
            return
    except Exception:
        pass
    number_id = os.environ.get("WHATSAPP_NUMBER_ID")
    token = os.environ.get("WHATSAPP_TOKEN")
    phone = os.environ.get("ALERT_PHONE", "")
    
    if not number_id or not token or not phone:
        print("  ⚠️  WhatsApp no configurado (faltan vars)")
        return
    
    try:
        url = f"https://graph.facebook.com/v19.0/{number_id}/messages"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        payload = {
            "messaging_product": "whatsapp",
            "to": phone,
            "type": "text",
            "text": {"body": message}
        }
        resp = requests.post(url, json=payload, headers=headers, timeout=10)
        if resp.status_code == 200:
            print(f"  📲 WhatsApp enviado a {phone}")
        else:
            print(f"  ⚠️  WhatsApp error: {resp.status_code} {resp.text[:100]}")
    except Exception as e:
        print(f"  ⚠️  Error WhatsApp: {e}")


# ── Heartbeat ─────────────────────────────────────────────────
def get_cpu_temp():
    """Lee la temperatura del CPU de la Raspberry Pi."""
    try:
        # Método 1: vcgencmd (RPi OS)
        import subprocess
        result = subprocess.run(["vcgencmd", "measure_temp"], capture_output=True, text=True, timeout=2)
        if result.returncode == 0:
            # Output: temp=45.0'C
            temp_str = result.stdout.strip().replace("temp=", "").replace("'C", "")
            return float(temp_str)
    except Exception:
        pass
    
    try:
        # Método 2: sysfs (Linux genérico)
        with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
            return float(f.read().strip()) / 1000.0
    except Exception:
        return None


def get_uptime():
    """Lee el uptime del sistema en segundos."""
    try:
        with open("/proc/uptime", "r") as f:
            return int(float(f.read().split()[0]))
    except Exception:
        return None


def get_local_ip():
    """Obtiene la IP local del dispositivo."""
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def heartbeat_loop(cameras_count_fn):
    """Thread loop que envía heartbeats cada 30 segundos a Supabase."""
    while running:
        try:
            payload = {
                "device_id": "rpi5",
                "cameras_processing": cameras_count_fn(),
                "cpu_temp": get_cpu_temp(),
                "uptime_seconds": get_uptime(),
                "ip_address": get_local_ip(),
                "version": "1.0.0",
                "last_seen": datetime.now().isoformat(),
            }
            
            headers = {
                **supabase_headers(),
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            }
            
            requests.post(
                f"{SUPABASE_URL}/rest/v1/home_heartbeats",
                json=payload,
                headers=headers,
                timeout=10,
            )
        except Exception as e:
            print(f"  ⚠️  Heartbeat error: {e}")
        
        # Dormir 30s en intervalos para poder detenerse rápidamente
        for _ in range(30):
            if not running:
                break
            time.sleep(1)


class CameraProcessor:
    """Procesa frames de una cámara: detección facial + celular."""
    
    def __init__(self, camera_config, known_encodings, known_names, known_ids):
        self.camera = camera_config
        self.name = camera_config["name"]
        self.rtsp_url = camera_config["rtsp_url"]
        self.known_encodings = known_encodings
        self.known_names = known_names
        self.known_ids = known_ids
        self.cap = None
        self.last_detection = {}  # person_name -> last_seen timestamp
        self.phone_sessions = {}  # camera_name -> {start: timestamp, last_seen: timestamp}
        self.reconnect_delay = 5
        self.yolo_model = None
        self._load_yolo()
    
    def _load_yolo(self):
        """Carga modelo YOLOv8-nano para detección de celulares."""
        try:
            from ultralytics import YOLO
            self.yolo_model = YOLO("yolov8n.pt")
            print(f"  🤖 {self.name}: YOLOv8-nano cargado")
        except ImportError:
            print(f"  ⚠️  {self.name}: ultralytics no instalado. Sin detección de celular.")
        except Exception as e:
            print(f"  ⚠️  {self.name}: Error cargando YOLO: {e}")
        
    def connect(self):
        """Conecta a la cámara vía RTSP."""
        try:
            self.cap = cv2.VideoCapture(self.rtsp_url)
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if self.cap.isOpened():
                print(f"  📹 {self.name}: Conectada")
                self.reconnect_delay = 5
                return True
            else:
                print(f"  ❌ {self.name}: No se pudo conectar")
                return False
        except Exception as e:
            print(f"  ❌ {self.name}: Error de conexión: {e}")
            return False
    
    def grab_frame(self):
        """Captura un frame de la cámara."""
        if not self.cap or not self.cap.isOpened():
            if not self.connect():
                time.sleep(self.reconnect_delay)
                self.reconnect_delay = min(60, self.reconnect_delay * 2)
                return None
        
        ret, frame = self.cap.read()
        if not ret:
            print(f"  ⚠️  {self.name}: Frame perdido, reconectando...")
            self.cap.release()
            self.cap = None
            return None
        
        return frame
    
    def detect_faces(self, frame):
        """Detecta y reconoce rostros en el frame."""
        try:
            import face_recognition
            
            # Reducir tamaño para velocidad
            small = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
            rgb_small = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
            
            # Detectar rostros
            locations = face_recognition.face_locations(rgb_small, model="hog")
            if locations:
                print(f"  👁️  {self.name}: {len(locations)} cara(s) detectada(s)")
            encodings = face_recognition.face_encodings(rgb_small, locations)
            
            for encoding in encodings:
                if len(self.known_encodings) == 0:
                    # No hay personas registradas
                    self._handle_detection("Desconocido", None, 0, False)
                    continue
                
                # Comparar con personas conocidas
                distances = face_recognition.face_distance(self.known_encodings, encoding)
                best_idx = np.argmin(distances)
                best_distance = distances[best_idx]
                
                if best_distance < FACE_TOLERANCE:
                    name = self.known_names[best_idx]
                    person_id = self.known_ids[best_idx]
                    confidence = 1.0 - best_distance
                    self._handle_detection(name, person_id, confidence, True)
                else:
                    self._handle_detection("Desconocido", None, 1.0 - best_distance, False)
                    
        except ImportError:
            print("  ⚠️  face_recognition no instalado. Saltando detección facial.")
        except Exception as e:
            print(f"  ❌ Error en detección facial: {e}")
    
    def detect_yolo(self, frame):
        """Detecta personas y celulares en el frame usando YOLOv8."""
        if self.yolo_model is None:
            return
        
        try:
            small = cv2.resize(frame, (416, 416))
            results = self.yolo_model(small, verbose=False, conf=0.35)
            
            phone_detected = False
            person_count = 0
            
            for result in results:
                for box in result.boxes:
                    cls_id = int(box.cls[0])
                    conf = float(box.conf[0])
                    if cls_id == 0:  # person
                        person_count += 1
                    elif cls_id == 67:  # cell phone
                        phone_detected = True
            
            # Handle person detection
            self._handle_person_detection(person_count)
            self._handle_phone_detection(phone_detected)
            
        except Exception as e:
            print(f"  ❌ Error en detección YOLO: {e}")
    
    def _handle_person_detection(self, count):
        """Maneja detección de personas por YOLO."""
        now = time.time()
        key = f"person_{self.name}"
        last = self.last_detection.get(key, 0)
        
        if count > 0 and now - last > 300:
            print(f"  🚶 {self.name}: {count} persona(s) detectada(s) por YOLO")
            send_event("person_detected", f"{count} persona(s)", self.name, 
                       confidence=None, person_id=None, is_known=True)
            msg = f"Persona detectada en {self.name} - Cantidad: {count} - Hora: {datetime.now().strftime(chr(37)+chr(72)+chr(58)+chr(37)+chr(77)+chr(58)+chr(37)+chr(83))}"
            send_whatsapp_alert(msg)
            self.last_detection[key] = now
    
    def _handle_phone_detection(self, detected):
        """Maneja la detección de celular, gestionando sesiones."""
        now = time.time()
        session = self.phone_sessions.get(self.name)
        
        if detected:
            if session is None:
                # Iniciar nueva sesión
                self.phone_sessions[self.name] = {
                    "start": now,
                    "last_seen": now,
                }
                print(f"  📱 {self.name}: Celular detectado — sesión iniciada")
            else:
                # Actualizar última vez visto
                session["last_seen"] = now
        else:
            if session is not None:
                # Si no vemos celular por más de PHONE_SESSION_TIMEOUT, cerrar sesión
                if now - session["last_seen"] > PHONE_SESSION_TIMEOUT:
                    duration = int(session["last_seen"] - session["start"])
                    if duration > 10:  # Solo guardar sesiones de más de 10 segundos
                        self._save_phone_session(session["start"], session["last_seen"], duration)
                    del self.phone_sessions[self.name]
    
    def _save_phone_session(self, start, end, duration):
        """Guarda una sesión de uso de celular en Supabase."""
        try:
            headers = {
                **supabase_headers(),
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }
            payload = {
                "camera_name": self.name,
                "person_name": "Desconocido",  # TODO: correlacionar con detección facial
                "started_at": datetime.fromtimestamp(start).isoformat(),
                "ended_at": datetime.fromtimestamp(end).isoformat(),
                "duration_seconds": duration,
            }
            requests.post(
                f"{SUPABASE_URL}/rest/v1/home_phone_sessions",
                headers=headers,
                json=payload,
            )
            mins = duration // 60
            secs = duration % 60
            print(f"  📱 {self.name}: Sesión guardada — {mins}m {secs}s")
            
            # Alerta WhatsApp si se supera el límite diario
            config = get_alert_config()
            if config.get("phone_usage_alert", True):
                limit_min = config.get("phone_limit_minutes", 60)
                if mins >= limit_min:
                    send_whatsapp_alert(
                        f"📱 ALERTA: Límite de celular superado\n"
                        f"⏱️ Sesión: {mins}m {secs}s\n"
                        f"📹 Cámara: {self.name}\n"
                        f"🕐 Hora: {datetime.now().strftime('%H:%M:%S')}"
                    )
        except Exception as e:
            print(f"  ❌ Error guardando sesión de celular: {e}")

    def _handle_detection(self, name, person_id, confidence, is_known):
        """Maneja una detección, evitando spam de eventos."""
        now = time.time()
        last = self.last_detection.get(name, 0)
        
        # Solo enviar evento si pasaron más de 5 minutos desde la última detección
        if now - last > 300:
            event_type = "detected" if is_known else "unknown_person"
            emoji = "🟢" if is_known else "🔴"
            print(f"  {emoji} {name} en {self.name} (confianza: {confidence:.0%})")
            send_event(event_type, name, self.name, confidence, person_id, is_known)
            self.last_detection[name] = now
            
            # Alerta WhatsApp para personas desconocidas
            if not is_known:
                config = get_alert_config()
                if config.get("unknown_person_alert", True):
                    send_whatsapp_alert(
                        f"🔴 ALERTA: Persona desconocida detectada\n"
                        f"📹 Cámara: {self.name}\n"
                        f"🕐 Hora: {datetime.now().strftime('%H:%M:%S')}"
                    )
    
    def release(self):
        """Libera la conexión y guarda sesiones pendientes."""
        # Cerrar sesiones de celular abiertas
        now = time.time()
        for cam_name, session in list(self.phone_sessions.items()):
            duration = int(now - session["start"])
            if duration > 10:
                self._save_phone_session(session["start"], now, duration)
        self.phone_sessions.clear()
        
        if self.cap:
            self.cap.release()


# ── Loop principal ────────────────────────────────────────────
def main():
    print("=" * 60)
    print("🏠 CONTROL HOME — Raspberry Pi 5 Service")
    print("=" * 60)
    print(f"⏰ Iniciado: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"🔄 Intervalo de detección: {DETECTION_INTERVAL}s")
    print()
    
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Falta configurar SUPABASE_URL y SUPABASE_KEY")
        print("   Ejecutar:")
        print("   export SUPABASE_URL=https://xxx.supabase.co")
        print("   export SUPABASE_KEY=sb_secret_xxx")
        sys.exit(1)
    
    # Cargar datos
    print("📂 Cargando configuración...")
    cameras = load_cameras()
    
    # Sincronizar face encodings desde fotos subidas
    sync_face_encodings()
    
    persons, known_encodings, known_names, known_ids = load_persons()
    
    print(f"  📹 {len(cameras)} cámara(s) configuradas")
    print(f"  👤 {len(persons)} persona(s) autorizadas")
    print(f"  🧬 {len(known_encodings)} encoding(s) faciales")
    print()
    
    if not cameras:
        print("⚠️  No hay cámaras configuradas. Agregá cámaras desde el dashboard web.")
        print("   Esperando configuración...")
        while running:
            time.sleep(30)
            cameras = load_cameras()
            if cameras:
                break
    
    # Crear procesadores
    processors = []
    for cam in cameras:
        proc = CameraProcessor(cam, known_encodings, known_names, known_ids)
        processors.append(proc)
    
    print("🚀 Iniciando procesamiento de cámaras...")
    print("-" * 60)
    
    # Iniciar thread de heartbeat
    hb_thread = threading.Thread(
        target=heartbeat_loop,
        args=(lambda: len(processors),),
        daemon=True
    )
    hb_thread.start()
    print("💓 Heartbeat activo (cada 30s)")
    
    # Recargar personas cada 5 minutos
    os.makedirs("/home/pi/control-home/snapshots", exist_ok=True)
    last_reload = time.time()
    
    while running:
        for proc in processors:
            if not running:
                break
            
            frame = proc.grab_frame()
            if frame is not None:
                # Save snapshot for preview server
                try:
                    import re as _re
                    _m = _re.search(r"@(\d+\.\d+\.\d+\.\d+)", proc.rtsp_url)
                    if _m:
                        _ip = _m.group(1)
                        cv2.imwrite(f"/home/pi/control-home/snapshots/{_ip}.jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                except Exception:
                    pass
                proc.detect_faces(frame)
                proc.detect_yolo(frame)
        
        # Recargar personas y re-sincronizar encodings periódicamente
        if time.time() - last_reload > 300:
            print("🔄 Recargando personas y encodings...")
            sync_face_encodings()
            _, known_encodings, known_names, known_ids = load_persons()
            for proc in processors:
                proc.known_encodings = known_encodings
                proc.known_names = known_names
                proc.known_ids = known_ids
            last_reload = time.time()
            print(f"  ✅ {len(known_names)} encoding(s) cargados")
        
        time.sleep(DETECTION_INTERVAL)
    
    # Limpieza
    for proc in processors:
        proc.release()
    
    print("\n✅ Servicio detenido correctamente")


if __name__ == "__main__":
    main()

