"""
Procesador de datos CSI (Channel State Information).
Extrae amplitud/fase de pares I/Q, calcula varianza, detecta presencia.
"""

import numpy as np
from collections import deque


class CSIProcessor:
    """
    Procesa datos CSI raw y determina presencia humana
    basándose en la varianza de la señal.
    """

    def __init__(self, window_size=50, num_subcarriers=64):
        """
        Args:
            window_size: Tamaño de ventana para cálculo de varianza
            num_subcarriers: Número de subportadoras
        """
        self.window_size = window_size
        self.num_subcarriers = num_subcarriers

        # Historial de amplitudes (ventana deslizante)
        self.amplitude_history = deque(maxlen=window_size)

        # Configuración de detección
        self.config = {
            "threshold": 12.0,          # Umbral de varianza para presencia
            "movement_threshold": 25.0,  # Umbral para movimiento activo
            "sensitivity": 0.7,          # Sensibilidad general (0-1)
            "window_size": window_size,
            "smoothing_factor": 0.3,     # Factor de suavizado exponencial
        }

        # Estado de detección
        self.current_variance = 0.0
        self.smoothed_variance = 0.0
        self.presence_detected = False
        self.movement_detected = False
        self.detection_count = 0
        self.last_detection_time = None

        # Estadísticas
        self.total_frames = 0
        self.presence_frames = 0
        self.start_time = None

        # Historial de varianzas para el gráfico
        self.variance_history = deque(maxlen=200)

        # Baseline (se calcula automáticamente con los primeros frames)
        self.baseline_amplitudes = None
        self.baseline_frames = 0
        self.baseline_window = 30  # Frames para calibrar baseline

    def update_config(self, new_config):
        """Actualiza configuración de detección."""
        self.config.update(new_config)
        if "window_size" in new_config:
            new_size = new_config["window_size"]
            old_data = list(self.amplitude_history)
            self.amplitude_history = deque(old_data[-new_size:], maxlen=new_size)

    def process(self, csi_frame, config=None):
        """
        Procesa un frame CSI y retorna datos procesados para el dashboard.

        Args:
            csi_frame: dict con 'amplitudes', 'phases', 'rssi', etc.
            config: configuración opcional para override

        Returns:
            dict con datos procesados para el frontend
        """
        if config:
            self.update_config(config)

        if self.start_time is None:
            self.start_time = csi_frame.get("timestamp", 0)

        self.total_frames += 1

        # Obtener amplitudes (ya vienen calculadas del simulador o del parser)
        amplitudes = np.array(csi_frame.get("amplitudes", []))

        if len(amplitudes) == 0:
            return self._empty_result(csi_frame)

        # Calibrar baseline con los primeros frames
        if self.baseline_frames < self.baseline_window:
            self._update_baseline(amplitudes)

        # Agregar al historial
        self.amplitude_history.append(amplitudes)

        # Calcular varianza por subportadora
        if len(self.amplitude_history) >= 3:
            history_matrix = np.array(list(self.amplitude_history))
            subcarrier_variance = np.var(history_matrix, axis=0)
            self.current_variance = float(np.mean(subcarrier_variance))
        else:
            self.current_variance = 0.0
            subcarrier_variance = np.zeros(self.num_subcarriers)

        # Suavizado exponencial de la varianza
        alpha = self.config["smoothing_factor"]
        self.smoothed_variance = (
            alpha * self.current_variance +
            (1 - alpha) * self.smoothed_variance
        )

        # Aplicar sensibilidad al umbral
        sensitivity = self.config["sensitivity"]
        effective_threshold = self.config["threshold"] * (1.5 - sensitivity)
        movement_threshold = self.config["movement_threshold"] * (1.5 - sensitivity)

        # Detección de presencia
        was_present = self.presence_detected
        self.presence_detected = self.smoothed_variance > effective_threshold
        self.movement_detected = self.smoothed_variance > movement_threshold

        # Contar detecciones (transiciones a presente)
        if self.presence_detected and not was_present:
            self.detection_count += 1
            self.last_detection_time = csi_frame.get("timestamp", 0)

        if self.presence_detected:
            self.presence_frames += 1

        # Guardar varianza en historial
        self.variance_history.append(self.smoothed_variance)

        # Calcular estadísticas
        avg_amplitude = float(np.mean(amplitudes))
        max_amplitude = float(np.max(amplitudes))

        # Determinar nivel de actividad
        if self.movement_detected:
            activity_level = "movimiento"
            presence_label = "🔴 Movimiento Detectado"
        elif self.presence_detected:
            activity_level = "presencia"
            presence_label = "🟠 Presencia Detectada"
        else:
            activity_level = "vacío"
            presence_label = "🟢 Sin Presencia"

        # Calcular desviación respecto al baseline
        baseline_deviation = 0.0
        if self.baseline_amplitudes is not None:
            baseline_deviation = float(
                np.mean(np.abs(amplitudes - self.baseline_amplitudes))
            )

        return {
            "type": "csi_frame",
            "timestamp": csi_frame.get("timestamp", 0),
            "frame_number": csi_frame.get("frame_number", self.total_frames),

            # Datos de señal
            "amplitudes": amplitudes.tolist(),
            "phases": csi_frame.get("phases", []),
            "rssi": csi_frame.get("rssi", -70),
            "noise_floor": csi_frame.get("noise_floor", -95),

            # Análisis
            "variance": round(self.smoothed_variance, 2),
            "raw_variance": round(self.current_variance, 2),
            "subcarrier_variance": subcarrier_variance.tolist(),
            "baseline_deviation": round(baseline_deviation, 2),

            # Detección
            "presence": self.presence_detected,
            "movement": self.movement_detected,
            "activity_level": activity_level,
            "presence_label": presence_label,

            # Configuración actual
            "threshold": round(effective_threshold, 2),
            "movement_threshold": round(movement_threshold, 2),

            # Estadísticas
            "stats": {
                "avg_amplitude": round(avg_amplitude, 2),
                "max_amplitude": round(max_amplitude, 2),
                "max_variance": round(max(self.variance_history) if self.variance_history else 0, 2),
                "detection_count": self.detection_count,
                "total_frames": self.total_frames,
                "presence_percentage": round(
                    100 * self.presence_frames / max(1, self.total_frames), 1
                ),
                "uptime": round(
                    csi_frame.get("timestamp", 0) - self.start_time, 1
                ) if self.start_time else 0,
            },

            # Historial de varianza (para gráfico)
            "variance_history": list(self.variance_history),

            # Estado del simulador (solo en modo demo)
            "sim_state": csi_frame.get("state", None),
        }

    def _update_baseline(self, amplitudes):
        """Actualiza el baseline de amplitudes (primeros N frames)."""
        if self.baseline_amplitudes is None:
            self.baseline_amplitudes = amplitudes.copy()
        else:
            # Media acumulativa
            self.baseline_amplitudes = (
                self.baseline_amplitudes * self.baseline_frames + amplitudes
            ) / (self.baseline_frames + 1)
        self.baseline_frames += 1

    def _empty_result(self, csi_frame):
        """Retorna resultado vacío cuando no hay datos."""
        return {
            "type": "csi_frame",
            "timestamp": csi_frame.get("timestamp", 0),
            "amplitudes": [],
            "phases": [],
            "rssi": -99,
            "noise_floor": -99,
            "variance": 0,
            "raw_variance": 0,
            "subcarrier_variance": [],
            "baseline_deviation": 0,
            "presence": False,
            "movement": False,
            "activity_level": "sin_datos",
            "presence_label": "⚪ Sin Datos",
            "threshold": 0,
            "movement_threshold": 0,
            "stats": {},
            "variance_history": [],
            "sim_state": None,
        }

    def reset(self):
        """Reinicia el procesador."""
        self.amplitude_history.clear()
        self.variance_history.clear()
        self.current_variance = 0.0
        self.smoothed_variance = 0.0
        self.presence_detected = False
        self.movement_detected = False
        self.detection_count = 0
        self.total_frames = 0
        self.presence_frames = 0
        self.baseline_amplitudes = None
        self.baseline_frames = 0
        self.start_time = None


def parse_csi_line(line):
    """
    Parsea una línea de datos CSI del formato ESP32-CSI-Tool.
    
    Formato típico de ESP32-CSI-Tool:
    CSI_DATA,<mac>,<rssi>,<rate>,<sig_mode>,<mcs>,<bandwidth>,<smoothing>,
    <not_sounding>,<aggregation>,<stbc>,<fec_coding>,<sgi>,<noise_floor>,
    <ampdu_cnt>,<channel>,<secondary_channel>,<local_timestamp>,<ant>,
    <sig_len>,<rx_state>,<real_time_set>,<real_timestamp>,<len>,
    "[I1,Q1,I2,Q2,...,I64,Q64]"

    Args:
        line: String con una línea de datos CSI

    Returns:
        dict con amplitudes, fases, rssi, etc. o None si la línea no es válida
    """
    try:
        if not line.startswith("CSI_DATA"):
            return None

        parts = line.strip().split(",")
        if len(parts) < 25:
            return None

        rssi = int(parts[2])
        noise_floor = int(parts[13])
        channel = int(parts[15])

        # Extraer array de I/Q values
        # Los valores están entre corchetes al final
        iq_str = ",".join(parts[23:])
        iq_str = iq_str.strip().strip("[]\"")
        iq_values = [int(x.strip()) for x in iq_str.split(",") if x.strip()]

        # Convertir pares I/Q a amplitud y fase
        num_pairs = len(iq_values) // 2
        amplitudes = []
        phases = []

        for i in range(num_pairs):
            real = iq_values[2 * i]
            imag = iq_values[2 * i + 1]
            amplitude = np.sqrt(real**2 + imag**2)
            phase = np.arctan2(imag, real)
            amplitudes.append(amplitude)
            phases.append(phase)

        return {
            "timestamp": time.time(),
            "amplitudes": amplitudes,
            "phases": phases,
            "rssi": rssi,
            "noise_floor": noise_floor,
            "channel": channel,
            "num_subcarriers": num_pairs,
        }

    except (ValueError, IndexError) as e:
        return None


# Necesario para parse_csi_line
import time
