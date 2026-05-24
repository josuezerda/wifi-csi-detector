"""
Simulador de datos CSI (Channel State Information) realistas.
Genera datos que imitan el comportamiento real de un ESP32 recibiendo señales WiFi
perturbadas por presencia humana.
"""

import numpy as np
import time
import random


class CSISimulator:
    """
    Genera frames CSI simulados con 64 subportadoras.
    Cicla entre estados: vacío → persona entra → movimiento → quieto → persona sale.
    """

    # Estados del simulador
    STATE_EMPTY = "empty"
    STATE_ENTERING = "entering"
    STATE_MOVING = "moving"
    STATE_STILL = "still"
    STATE_LEAVING = "leaving"
    STATE_BREATHING = "breathing"

    # Transiciones de estado y duración (segundos)
    STATE_TRANSITIONS = {
        STATE_EMPTY: (STATE_ENTERING, (8, 15)),
        STATE_ENTERING: (STATE_MOVING, (2, 4)),
        STATE_MOVING: (STATE_STILL, (5, 10)),
        STATE_STILL: (STATE_BREATHING, (5, 10)),
        STATE_BREATHING: (STATE_LEAVING, (8, 15)),
        STATE_LEAVING: (STATE_EMPTY, (2, 4)),
    }

    def __init__(self, num_subcarriers=64, sample_rate=10):
        """
        Args:
            num_subcarriers: Número de subportadoras WiFi (64 para 20MHz)
            sample_rate: Frames por segundo
        """
        self.num_subcarriers = num_subcarriers
        self.sample_rate = sample_rate

        # Estado actual
        self.state = self.STATE_EMPTY
        self.state_start_time = time.time()
        self.state_duration = random.uniform(5, 10)

        # Señal base por subportadora (cada una tiene su amplitud natural)
        self.base_amplitudes = self._generate_base_profile()

        # RSSI base
        self.base_rssi = -55
        self.noise_floor = -95

        # Contadores
        self.frame_count = 0
        self.transition_progress = 0.0

        # Para efecto de respiración
        self.breath_phase = 0.0
        self.breath_rate = 0.3  # Hz (~18 respiraciones/minuto)

        # Para movimiento suave
        self.movement_phase = 0.0

    def _generate_base_profile(self):
        """
        Genera el perfil de amplitud base por subportadora.
        En la realidad, las subportadoras centrales tienen mayor amplitud.
        """
        x = np.linspace(-1, 1, self.num_subcarriers)
        # Perfil tipo campana con variaciones
        profile = 20 + 8 * np.exp(-2 * x**2)
        # Agregar variación individual
        profile += np.random.normal(0, 1.5, self.num_subcarriers)
        return np.clip(profile, 5, 35)

    def _check_state_transition(self):
        """Verifica si debe cambiar de estado."""
        elapsed = time.time() - self.state_start_time
        if elapsed >= self.state_duration:
            next_state, duration_range = self.STATE_TRANSITIONS[self.state]
            self.state = next_state
            self.state_start_time = time.time()
            self.state_duration = random.uniform(*duration_range)
            self.transition_progress = 0.0

    def _get_transition_progress(self):
        """Calcula el progreso de transición suave (0.0 a 1.0)."""
        elapsed = time.time() - self.state_start_time
        return min(1.0, elapsed / max(0.1, self.state_duration))

    def generate_frame(self):
        """
        Genera un frame CSI completo con datos realistas.

        Returns:
            dict con:
                - timestamp: tiempo actual
                - amplitudes: array de 64 amplitudes
                - phases: array de 64 fases
                - rssi: indicador de fuerza de señal
                - noise_floor: piso de ruido
                - raw_iq: pares I/Q raw (para compatibilidad)
                - state: estado actual del simulador (solo en modo demo)
        """
        self._check_state_transition()
        progress = self._get_transition_progress()
        self.frame_count += 1
        dt = 1.0 / self.sample_rate

        # Ruido base gaussiano
        noise = np.random.normal(0, 1.2, self.num_subcarriers)

        # Amplitudes = base + perturbación según estado
        amplitudes = self.base_amplitudes.copy() + noise
        perturbation = np.zeros(self.num_subcarriers)

        if self.state == self.STATE_EMPTY:
            # Solo ruido base, señal estable
            pass

        elif self.state == self.STATE_ENTERING:
            # Perturbación gradual creciente
            intensity = progress * 0.6
            pattern = self._human_perturbation_pattern(intensity)
            perturbation = pattern * progress

        elif self.state == self.STATE_MOVING:
            # Perturbación fuerte y variable (movimiento)
            self.movement_phase += dt * random.uniform(2, 5)
            intensity = 0.8 + 0.2 * np.sin(self.movement_phase)
            perturbation = self._human_perturbation_pattern(intensity)
            # Agregar variabilidad extra por movimiento
            perturbation += np.random.normal(0, 3.0, self.num_subcarriers)

        elif self.state == self.STATE_STILL:
            # Perturbación moderada y estable (persona quieta)
            intensity = 0.5
            perturbation = self._human_perturbation_pattern(intensity)
            # Pequeña variación por micro-movimientos
            perturbation += np.random.normal(0, 0.8, self.num_subcarriers)

        elif self.state == self.STATE_BREATHING:
            # Perturbación sutil rítmica (respiración detectable)
            self.breath_phase += dt * 2 * np.pi * self.breath_rate
            breath_effect = 2.5 * np.sin(self.breath_phase)
            intensity = 0.4 + 0.1 * np.sin(self.breath_phase)
            perturbation = self._human_perturbation_pattern(intensity)
            # Modulación por respiración (afecta más a subportadoras centrales)
            center = self.num_subcarriers // 2
            breath_mask = np.exp(-0.5 * ((np.arange(self.num_subcarriers) - center) / 15)**2)
            perturbation += breath_effect * breath_mask

        elif self.state == self.STATE_LEAVING:
            # Perturbación decreciente
            intensity = 0.5 * (1 - progress)
            perturbation = self._human_perturbation_pattern(intensity)

        amplitudes += perturbation
        amplitudes = np.clip(amplitudes, 1, 50)

        # Generar fases (correlacionadas con amplitud)
        base_phases = np.linspace(-np.pi, np.pi, self.num_subcarriers)
        phase_noise = np.random.normal(0, 0.3, self.num_subcarriers)
        phases = base_phases + phase_noise
        if self.state in [self.STATE_MOVING, self.STATE_ENTERING, self.STATE_LEAVING]:
            phases += np.random.normal(0, 0.8, self.num_subcarriers)

        # Generar pares I/Q desde amplitud y fase
        i_values = amplitudes * np.cos(phases)
        q_values = amplitudes * np.sin(phases)

        # RSSI varía según presencia
        rssi_perturbation = 0
        if self.state in [self.STATE_MOVING, self.STATE_STILL, self.STATE_BREATHING]:
            rssi_perturbation = random.uniform(-8, -3)
        elif self.state == self.STATE_ENTERING:
            rssi_perturbation = -5 * progress
        elif self.state == self.STATE_LEAVING:
            rssi_perturbation = -5 * (1 - progress)

        rssi = self.base_rssi + rssi_perturbation + random.uniform(-2, 2)

        return {
            "timestamp": time.time(),
            "amplitudes": amplitudes.tolist(),
            "phases": phases.tolist(),
            "rssi": round(rssi, 1),
            "noise_floor": self.noise_floor + random.uniform(-1, 1),
            "raw_iq": list(zip(i_values.tolist(), q_values.tolist())),
            "state": self.state,
            "frame_number": self.frame_count,
        }

    def _human_perturbation_pattern(self, intensity):
        """
        Genera un patrón de perturbación realista causado por un cuerpo humano.
        El cuerpo humano afecta más a ciertas subportadoras según su posición
        y las reflexiones/absorciones que causa.

        Args:
            intensity: 0.0 (sin efecto) a 1.0 (máximo efecto)
        """
        n = self.num_subcarriers
        x = np.arange(n)

        # El cuerpo humano crea múltiples "huecos" y "picos" en el espectro
        # Patrón principal centrado en subportadoras medias
        center1 = n // 2 + random.randint(-5, 5)
        center2 = n // 3 + random.randint(-3, 3)

        pattern = (
            6.0 * intensity * np.exp(-0.5 * ((x - center1) / 10)**2)
            + 3.0 * intensity * np.exp(-0.5 * ((x - center2) / 8)**2)
            + 2.0 * intensity * np.sin(x / n * 4 * np.pi)
        )

        # Efecto de multipath (señal rebotada por el cuerpo)
        pattern *= (1 + 0.3 * np.sin(x / n * 6 * np.pi + random.uniform(0, 2 * np.pi)))

        return pattern * intensity

    def get_state_label(self):
        """Retorna etiqueta legible del estado actual."""
        labels = {
            self.STATE_EMPTY: "🟢 Vacío",
            self.STATE_ENTERING: "🟡 Persona entrando",
            self.STATE_MOVING: "🔴 Movimiento detectado",
            self.STATE_STILL: "🟠 Persona presente (quieta)",
            self.STATE_BREATHING: "🟣 Respiración detectada",
            self.STATE_LEAVING: "🟡 Persona saliendo",
        }
        return labels.get(self.state, "❓ Desconocido")

    def force_state(self, state):
        """Fuerza un cambio de estado (para testing)."""
        if state in self.STATE_TRANSITIONS:
            self.state = state
            self.state_start_time = time.time()
            self.state_duration = random.uniform(5, 15)
