/**
 * Spectra — Plataforma de Percepción Espacial
 * Dashboard con detección RF, cámaras, control home y terminal
 */

// ═══════════════════════════════════════════════════════════
// Page Navigation
// ═══════════════════════════════════════════════════════════

const PAGE_TITLES = {
    detection: 'Detección RF',
    cameras: 'Cámaras de Seguridad',
    smarthome: 'Control Home',
    persons: 'Personas Autorizadas',
    activity: 'Actividad',
    terminal: 'Terminal en Vivo',
    settings: 'Configuración',
};

document.addEventListener('DOMContentLoaded', () => {
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    navItems.forEach(btn => {
        btn.addEventListener('click', () => {
            const page = btn.dataset.page;
            // Update nav active state
            navItems.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Show/hide pages
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            const target = document.getElementById('page-' + page);
            if (target) target.classList.add('active');
            // Update header title
            const titleEl = document.getElementById('page-title');
            if (titleEl) titleEl.textContent = PAGE_TITLES[page] || page;
            // Show/hide mode toggle (only on detection page)
            const modeToggle = document.getElementById('mode-toggle');
            if (modeToggle) modeToggle.style.display = page === 'detection' ? '' : 'none';
            // Lazy-load terminal iframe
            if (page === 'terminal') {
                const iframe = document.getElementById('terminal-iframe');
                if (iframe && !iframe.src) {
                    iframe.src = iframe.dataset.src;
                }
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════
// Configuración
// ═══════════════════════════════════════════════════════════

const CONFIG = {
    wsUrl: `ws://${window.location.hostname || 'localhost'}:8765`,
    reconnectInterval: 3000,
    maxDataPoints: 120,       // Puntos en gráfico de varianza
    heatmapHistory: 80,       // Columnas del heatmap
    numSubcarriers: 64,
    chartUpdateRate: 100,     // ms entre actualizaciones de gráficos
};

// ═══════════════════════════════════════════════════════════
// Estado Global
// ═══════════════════════════════════════════════════════════

const state = {
    ws: null,
    connected: false,
    mode: 'demo',
    lastFrame: null,
    frameCount: 0,
    fpsCounter: 0,
    fps: 0,
    heatmapData: [],
    events: [],
    charts: {},
};

// ═══════════════════════════════════════════════════════════
// WebSocket Connection
// ═══════════════════════════════════════════════════════════

function connectWebSocket() {
    updateConnectionStatus('connecting', 'Conectando...');

    try {
        state.ws = new WebSocket(CONFIG.wsUrl);
    } catch (e) {
        updateConnectionStatus('disconnected', 'Error de conexión');
        scheduleReconnect();
        return;
    }

    state.ws.onopen = () => {
        state.connected = true;
        updateConnectionStatus('connected', 'Conectado');
        addEvent('info', 'Conectado al servidor');
    };

    state.ws.onclose = () => {
        state.connected = false;
        updateConnectionStatus('disconnected', 'Desconectado');
        scheduleReconnect();
    };

    state.ws.onerror = () => {
        state.connected = false;
        updateConnectionStatus('disconnected', 'Error de conexión');
    };

    state.ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleMessage(data);
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    };
}

function scheduleReconnect() {
    setTimeout(() => {
        if (!state.connected) {
            connectWebSocket();
        }
    }, CONFIG.reconnectInterval);
}

function sendMessage(data) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(data));
    }
}

// ═══════════════════════════════════════════════════════════
// Message Handler
// ═══════════════════════════════════════════════════════════

function handleMessage(data) {
    switch (data.type) {
        case 'init':
            handleInit(data);
            break;
        case 'csi_frame':
            handleCSIFrame(data);
            break;
        case 'mode_change':
            handleModeChange(data);
            break;
        case 'serial_status':
            handleSerialStatus(data);
            break;
        case 'port_list':
            handlePortList(data);
            break;
    }
}

function handleInit(data) {
    state.mode = data.mode;
    updateModeUI(data.mode);
    if (data.config) {
        updateSettingsUI(data.config);
    }
    addEvent('info', `Modo: ${data.mode === 'demo' ? 'Demostración' : 'En Vivo'}`);
}

function handleCSIFrame(data) {
    state.lastFrame = data;
    state.frameCount++;
    state.fpsCounter++;

    updatePresenceUI(data);
    updateStatsUI(data);
    updateAmplitudeChart(data);
    updateVarianceChart(data);
    updateHeatmap(data);
    updateEventsFromFrame(data);
}

function handleModeChange(data) {
    state.mode = data.mode;
    updateModeUI(data.mode);
    addEvent('info', `Modo cambiado a: ${data.mode === 'demo' ? 'Demostración' : 'En Vivo'}`);
}

function handleSerialStatus(data) {
    const status = data.status;
    const display = document.getElementById('serial-status-display');
    if (display) {
        const dot = display.querySelector('.status-dot');
        const text = display.querySelector('span:last-child');
        if (status.connected) {
            dot.className = 'status-dot connected';
            text.textContent = `Conectado (${status.port})`;
        } else {
            dot.className = 'status-dot disconnected';
            text.textContent = status.error_message || 'Desconectado';
        }
    }
}

function handlePortList(data) {
    const select = document.getElementById('serial-port-select');
    if (!select) return;
    select.innerHTML = '<option value="">Seleccionar puerto...</option>';
    data.ports.forEach(port => {
        const option = document.createElement('option');
        option.value = port.device;
        option.textContent = `${port.device} — ${port.description}`;
        if (port.is_esp32) option.textContent += ' ⭐';
        select.appendChild(option);
    });
}

// ═══════════════════════════════════════════════════════════
// UI Updates
// ═══════════════════════════════════════════════════════════

function updateConnectionStatus(status, text) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-text');

    if (dot) dot.className = `status-dot ${status}`;
    if (label) label.textContent = text;
}

function updatePresenceUI(data) {
    const card = document.getElementById('presence-card');
    const label = document.getElementById('presence-label');
    const sublabel = document.getElementById('presence-sublabel');
    const icon = document.getElementById('presence-icon');
    const varianceEl = document.getElementById('variance-value');

    // Actualizar varianza
    varianceEl.textContent = (data.variance || 0).toFixed(1);

    // Actualizar estado visual
    card.classList.remove('detected', 'movement');

    if (data.movement) {
        card.classList.add('movement');
        label.textContent = '🔴 Movimiento Detectado';
        sublabel.textContent = `Varianza: ${data.variance?.toFixed(1)} (umbral: ${data.movement_threshold?.toFixed(1)})`;
        icon.textContent = '🏃';
    } else if (data.presence) {
        card.classList.add('detected');
        label.textContent = '🟠 Presencia Detectada';
        sublabel.textContent = `Varianza: ${data.variance?.toFixed(1)} (umbral: ${data.threshold?.toFixed(1)})`;
        icon.textContent = '🧍';
    } else {
        label.textContent = '🟢 Sin Presencia';
        sublabel.textContent = `Varianza: ${data.variance?.toFixed(1)} — Entorno limpio`;
        icon.textContent = '👁️';
    }

    // Badge de detección
    const badge = document.getElementById('detection-badge');
    if (data.movement) {
        badge.textContent = '⚡ Movimiento';
        badge.className = 'badge presence-badge movement';
    } else if (data.presence) {
        badge.textContent = '🔴 Presencia';
        badge.className = 'badge presence-badge detected';
    } else {
        badge.textContent = 'Monitoreando';
        badge.className = 'badge presence-badge';
    }
}

function updateStatsUI(data) {
    const stats = data.stats || {};

    // RSSI
    const rssiEl = document.getElementById('stat-rssi-value');
    rssiEl.textContent = data.rssi?.toFixed(0) || '--';

    // Detecciones
    const detEl = document.getElementById('stat-detections-value');
    detEl.textContent = stats.detection_count || 0;

    // FPS
    const fpsEl = document.getElementById('stat-frames-value');
    fpsEl.textContent = state.fps;

    // Uptime
    const uptimeEl = document.getElementById('stat-uptime-value');
    const uptime = stats.uptime || 0;
    const mins = Math.floor(uptime / 60);
    const secs = Math.floor(uptime % 60);
    uptimeEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    // Info panel
    document.getElementById('info-mode').textContent = state.mode === 'demo' ? 'Demo' : 'Live';
    document.getElementById('info-frames').textContent = stats.total_frames || 0;
    document.getElementById('info-presence').textContent = `${stats.presence_percentage || 0}%`;
    document.getElementById('info-server').textContent = CONFIG.wsUrl;
}

function updateModeUI(mode) {
    document.getElementById('btn-demo').classList.toggle('active', mode === 'demo');
    document.getElementById('btn-live').classList.toggle('active', mode === 'live');
}

function updateSettingsUI(config) {
    if (config.threshold !== undefined) {
        document.getElementById('setting-threshold').value = config.threshold;
        document.getElementById('threshold-display').textContent = config.threshold.toFixed(1);
    }
    if (config.movement_threshold !== undefined) {
        document.getElementById('setting-movement').value = config.movement_threshold;
        document.getElementById('movement-display').textContent = config.movement_threshold;
    }
    if (config.sensitivity !== undefined) {
        document.getElementById('setting-sensitivity').value = config.sensitivity;
        document.getElementById('sensitivity-display').textContent = config.sensitivity.toFixed(2);
    }
    if (config.window_size !== undefined) {
        document.getElementById('setting-window').value = config.window_size;
        document.getElementById('window-display').textContent = config.window_size;
    }
}

// ═══════════════════════════════════════════════════════════
// Charts — Amplitude
// ═══════════════════════════════════════════════════════════

function initAmplitudeChart() {
    const ctx = document.getElementById('amplitude-chart').getContext('2d');

    const labels = Array.from({ length: CONFIG.numSubcarriers }, (_, i) => i + 1);

    state.charts.amplitude = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Amplitud',
                data: new Array(CONFIG.numSubcarriers).fill(0),
                backgroundColor: createAmplitudeGradient(ctx),
                borderColor: 'transparent',
                borderRadius: 2,
                barPercentage: 0.85,
                categoryPercentage: 0.9,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 80 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(12, 18, 32, 0.95)',
                    titleColor: '#e8ecf4',
                    bodyColor: '#8892a4',
                    borderColor: 'rgba(0, 229, 255, 0.3)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    titleFont: { family: 'Inter', weight: '600' },
                    bodyFont: { family: 'JetBrains Mono', size: 12 },
                    callbacks: {
                        title: (items) => `Subportadora #${items[0].label}`,
                        label: (item) => ` Amplitud: ${item.raw.toFixed(2)}`,
                    }
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: {
                        color: '#4a5568',
                        font: { family: 'JetBrains Mono', size: 9 },
                        maxTicksLimit: 16,
                    },
                    title: {
                        display: true,
                        text: 'Subportadora',
                        color: '#4a5568',
                        font: { family: 'Inter', size: 10 },
                    }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: {
                        color: '#4a5568',
                        font: { family: 'JetBrains Mono', size: 10 },
                    },
                    min: 0,
                    max: 50,
                    title: {
                        display: true,
                        text: 'Amplitud',
                        color: '#4a5568',
                        font: { family: 'Inter', size: 10 },
                    }
                },
            },
        },
    });
}

function createAmplitudeGradient(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(0, 229, 255, 0.9)');
    gradient.addColorStop(0.5, 'rgba(0, 229, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(0, 229, 255, 0.15)');
    return gradient;
}

function updateAmplitudeChart(data) {
    if (!state.charts.amplitude || !data.amplitudes) return;

    const chart = state.charts.amplitude;
    chart.data.datasets[0].data = data.amplitudes;

    // Colorear según presencia
    const ctx = chart.ctx;
    if (data.movement) {
        const g = ctx.createLinearGradient(0, 0, 0, 300);
        g.addColorStop(0, 'rgba(255, 171, 0, 0.9)');
        g.addColorStop(1, 'rgba(255, 171, 0, 0.15)');
        chart.data.datasets[0].backgroundColor = g;
    } else if (data.presence) {
        const g = ctx.createLinearGradient(0, 0, 0, 300);
        g.addColorStop(0, 'rgba(255, 23, 68, 0.9)');
        g.addColorStop(1, 'rgba(255, 23, 68, 0.15)');
        chart.data.datasets[0].backgroundColor = g;
    } else {
        chart.data.datasets[0].backgroundColor = createAmplitudeGradient(ctx);
    }

    chart.update('none');
}

// ═══════════════════════════════════════════════════════════
// Charts — Variance
// ═══════════════════════════════════════════════════════════

function initVarianceChart() {
    const ctx = document.getElementById('variance-chart').getContext('2d');

    state.charts.variance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Varianza',
                    data: [],
                    borderColor: '#00e5ff',
                    backgroundColor: 'rgba(0, 229, 255, 0.08)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                },
                {
                    label: 'Umbral Presencia',
                    data: [],
                    borderColor: 'rgba(255, 23, 68, 0.5)',
                    borderWidth: 1.5,
                    borderDash: [6, 4],
                    fill: false,
                    pointRadius: 0,
                    tension: 0,
                },
                {
                    label: 'Umbral Movimiento',
                    data: [],
                    borderColor: 'rgba(255, 171, 0, 0.4)',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    fill: false,
                    pointRadius: 0,
                    tension: 0,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        color: '#8892a4',
                        font: { family: 'Inter', size: 10 },
                        boxWidth: 12,
                        boxHeight: 2,
                        padding: 12,
                        usePointStyle: false,
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(12, 18, 32, 0.95)',
                    titleColor: '#e8ecf4',
                    bodyColor: '#8892a4',
                    borderColor: 'rgba(0, 229, 255, 0.3)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    bodyFont: { family: 'JetBrains Mono', size: 11 },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: { display: false },
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: {
                        color: '#4a5568',
                        font: { family: 'JetBrains Mono', size: 10 },
                    },
                    min: 0,
                    suggestedMax: 40,
                    title: {
                        display: true,
                        text: 'Varianza',
                        color: '#4a5568',
                        font: { family: 'Inter', size: 10 },
                    }
                },
            },
        },
    });
}

function updateVarianceChart(data) {
    if (!state.charts.variance) return;

    const chart = state.charts.variance;
    const now = new Date();
    const timeLabel = `${now.getMinutes()}:${now.getSeconds().toString().padStart(2, '0')}`;

    // Agregar datos
    chart.data.labels.push(timeLabel);
    chart.data.datasets[0].data.push(data.variance || 0);
    chart.data.datasets[1].data.push(data.threshold || 12);
    chart.data.datasets[2].data.push(data.movement_threshold || 25);

    // Limitar puntos
    if (chart.data.labels.length > CONFIG.maxDataPoints) {
        chart.data.labels.shift();
        chart.data.datasets.forEach(ds => ds.data.shift());
    }

    // Color del fill según estado
    if (data.movement) {
        chart.data.datasets[0].borderColor = '#ffab00';
        chart.data.datasets[0].backgroundColor = 'rgba(255, 171, 0, 0.1)';
    } else if (data.presence) {
        chart.data.datasets[0].borderColor = '#ff1744';
        chart.data.datasets[0].backgroundColor = 'rgba(255, 23, 68, 0.08)';
    } else {
        chart.data.datasets[0].borderColor = '#00e5ff';
        chart.data.datasets[0].backgroundColor = 'rgba(0, 229, 255, 0.08)';
    }

    chart.update('none');
}

// ═══════════════════════════════════════════════════════════
// Room View — Canvas 2D
// ═══════════════════════════════════════════════════════════

const roomState = {
    personOpacity: 0,
    personX: 0.5,
    personY: 0.5,
    breathOffset: 0,
    walkPhase: 0,
    wavePhase: 0,
    signalParticles: [],
};

function initRoomView() {
    const canvas = document.getElementById('room-canvas');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width - 40;
    canvas.height = 280;

    // Generar partículas de señal
    for (let i = 0; i < 20; i++) {
        roomState.signalParticles.push({
            x: Math.random(),
            y: Math.random(),
            speed: 0.002 + Math.random() * 0.003,
            size: 1 + Math.random() * 2,
            opacity: 0.1 + Math.random() * 0.3,
        });
    }
}

function drawRoomView(data, targetCanvas) {
    const canvas = targetCanvas || document.getElementById('room-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // ─── Room background (floor grid) ───
    ctx.fillStyle = 'rgba(8, 16, 30, 0.9)';
    ctx.fillRect(0, 0, W, H);

    // Perspective grid
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.05)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
        const x = (i / 10) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        const y = (i / 10) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // ─── Room walls ───
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    // Room label
    ctx.fillStyle = 'rgba(136, 146, 164, 0.5)';
    ctx.font = '10px Inter';
    ctx.fillText('HABITACIÓN MONITOREADA', 20, 28);

    // ─── ESP32 devices ───
    const txX = 40, txY = H / 2;
    const rxX = W - 40, rxY = H / 2;

    // TX device
    drawESP32(ctx, txX, txY, 'TX', '#00e5ff');
    // RX device
    drawESP32(ctx, rxX, rxY, 'RX', '#00e676');

    // ─── WiFi signal waves ───
    roomState.wavePhase += 0.04;
    const numWaves = 5;
    for (let i = 0; i < numWaves; i++) {
        const phase = (roomState.wavePhase + i * 0.4) % 2;
        const progress = phase / 2;
        if (progress > 1) continue;
        const opacity = 0.3 * (1 - progress);
        const waveX = txX + (rxX - txX) * progress;

        ctx.strokeStyle = `rgba(0, 229, 255, ${opacity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(waveX, H / 2, 6 + progress * 20, 30 + progress * 40, 0, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
    }

    // ─── Signal particles ───
    roomState.signalParticles.forEach(p => {
        p.x += p.speed;
        if (p.x > 1) { p.x = 0; p.y = 0.2 + Math.random() * 0.6; }

        const px = txX + (rxX - txX) * p.x;
        const py = H * p.y;

        ctx.fillStyle = `rgba(0, 229, 255, ${p.opacity})`;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
    });

    // ─── Person silhouette ───
    const presence = data?.presence || false;
    const movement = data?.movement || false;
    const targetOpacity = presence ? 1 : 0;
    roomState.personOpacity += (targetOpacity - roomState.personOpacity) * 0.08;

    if (roomState.personOpacity > 0.02) {
        const cx = W * 0.5;
        const cy = H * 0.48;

        // Walking animation
        if (movement) {
            roomState.walkPhase += 0.08;
            roomState.personX += Math.sin(roomState.walkPhase * 0.5) * 0.003;
        }

        // Breathing animation
        roomState.breathOffset = Math.sin(Date.now() / 1500) * 2;

        const opacity = roomState.personOpacity;
        const personCx = cx + (roomState.personX - 0.5) * 100;

        // Detection glow
        const glowColor = movement ? 'rgba(255, 171, 0,' : 'rgba(255, 23, 68,';
        const glowRadius = movement ? 80 : 60;
        const grad = ctx.createRadialGradient(personCx, cy, 0, personCx, cy, glowRadius);
        grad.addColorStop(0, glowColor + (0.15 * opacity) + ')');
        grad.addColorStop(1, glowColor + '0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(personCx, cy, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // Signal disruption lines
        if (presence) {
            const disruptColor = movement ? 'rgba(255, 171, 0,' : 'rgba(255, 23, 68,';
            for (let i = 0; i < 3; i++) {
                const lineY = cy - 30 + i * 30;
                ctx.strokeStyle = disruptColor + (0.3 * opacity) + ')';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(personCx - 35, lineY);
                ctx.lineTo(personCx + 35, lineY);
                ctx.stroke();
            }
        }

        // Draw human figure
        drawHumanSilhouette(ctx, personCx, cy, opacity, movement, roomState.breathOffset, roomState.walkPhase);
    }

    // ─── Activity label overlay ───
    const badge = document.getElementById('room-activity-badge');
    if (movement) {
        badge.textContent = '🏃 Movimiento';
        badge.style.background = 'var(--accent-amber-dim)';
        badge.style.color = 'var(--accent-amber)';
    } else if (presence) {
        badge.textContent = '🧍 Presencia';
        badge.style.background = 'var(--accent-red-dim)';
        badge.style.color = 'var(--accent-red)';
    } else {
        badge.textContent = '✓ Vacío';
        badge.style.background = 'var(--accent-green-dim)';
        badge.style.color = 'var(--accent-green)';
    }
}

function drawESP32(ctx, x, y, label, color) {
    // PCB board
    ctx.fillStyle = 'rgba(20, 40, 60, 0.9)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    const bw = 28, bh = 40;
    ctx.beginPath();
    ctx.roundRect(x - bw/2, y - bh/2, bw, bh, 4);
    ctx.fill();
    ctx.stroke();

    // Antenna
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - bh/2);
    ctx.lineTo(x, y - bh/2 - 10);
    ctx.stroke();

    // LED indicator
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle = color;
    ctx.font = 'bold 9px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + bh/2 + 14);
    ctx.font = '7px Inter';
    ctx.fillStyle = 'rgba(136, 146, 164, 0.6)';
    ctx.fillText('ESP32', x, y + bh/2 + 24);
    ctx.textAlign = 'start';
}

function drawHumanSilhouette(ctx, cx, cy, opacity, isMoving, breathOff, walkPhase) {
    const scale = 0.9;
    const color = isMoving ? `rgba(255, 171, 0, ${opacity})` : `rgba(255, 80, 100, ${opacity})`;
    const outlineColor = isMoving ? `rgba(255, 171, 0, ${opacity * 0.3})` : `rgba(255, 80, 100, ${opacity * 0.3})`;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // Outer glow silhouette
    ctx.fillStyle = outlineColor;
    ctx.strokeStyle = 'transparent';

    // Head
    ctx.beginPath();
    ctx.arc(0, -52 + breathOff * 0.3, 16, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.ellipse(0, -15 + breathOff * 0.5, 18 + breathOff * 0.3, 30, 0, 0, Math.PI * 2);
    ctx.fill();

    // Inner solid silhouette
    ctx.fillStyle = color;

    // Head
    ctx.beginPath();
    ctx.arc(0, -52 + breathOff * 0.3, 12, 0, Math.PI * 2);
    ctx.fill();

    // Neck
    ctx.fillRect(-4, -42 + breathOff * 0.3, 8, 8);

    // Torso
    ctx.beginPath();
    ctx.ellipse(0, -15 + breathOff * 0.5, 14 + breathOff * 0.3, 25, 0, 0, Math.PI * 2);
    ctx.fill();

    // Arms
    const armSwing = isMoving ? Math.sin(walkPhase) * 15 : 0;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;

    // Left arm
    ctx.beginPath();
    ctx.moveTo(-14, -30 + breathOff * 0.3);
    ctx.lineTo(-22, -5 + armSwing);
    ctx.stroke();

    // Right arm
    ctx.beginPath();
    ctx.moveTo(14, -30 + breathOff * 0.3);
    ctx.lineTo(22, -5 - armSwing);
    ctx.stroke();

    // Legs
    const legSwing = isMoving ? Math.sin(walkPhase) * 12 : 0;
    ctx.lineWidth = 7;

    // Left leg
    ctx.beginPath();
    ctx.moveTo(-7, 8);
    ctx.lineTo(-12 + legSwing, 50);
    ctx.stroke();

    // Right leg
    ctx.beginPath();
    ctx.moveTo(7, 8);
    ctx.lineTo(12 - legSwing, 50);
    ctx.stroke();

    ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// Radar Sonar — Canvas 2D
// ═══════════════════════════════════════════════════════════

const radarState = {
    sweepAngle: 0,
    blips: [],
    trailHistory: [],
};

function initRadar() {
    const canvas = document.getElementById('radar-canvas');
    canvas.width = 280;
    canvas.height = 280;
}

function drawRadar(data, targetCanvas) {
    const canvas = targetCanvas || document.getElementById('radar-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.min(W, H) / 2 - 10;

    ctx.clearRect(0, 0, W, H);

    // ─── Background ───
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    bgGrad.addColorStop(0, 'rgba(0, 20, 30, 0.8)');
    bgGrad.addColorStop(1, 'rgba(0, 10, 15, 0.95)');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
    ctx.fill();

    // ─── Range rings ───
    const ranges = [0.25, 0.5, 0.75, 1.0];
    const rangeLabels = ['1m', '2m', '3m', '5m'];
    ranges.forEach((r, i) => {
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * r, 0, Math.PI * 2);
        ctx.stroke();

        // Range labels
        ctx.fillStyle = 'rgba(0, 229, 255, 0.25)';
        ctx.font = '8px JetBrains Mono';
        ctx.textAlign = 'center';
        ctx.fillText(rangeLabels[i], cx, cy - maxR * r + 10);
    });

    // ─── Cross hairs ───
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy); ctx.stroke();

    // Diagonal lines
    ctx.beginPath(); ctx.moveTo(cx - maxR * 0.707, cy - maxR * 0.707); ctx.lineTo(cx + maxR * 0.707, cy + maxR * 0.707); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + maxR * 0.707, cy - maxR * 0.707); ctx.lineTo(cx - maxR * 0.707, cy + maxR * 0.707); ctx.stroke();

    // ─── Sweep line ───
    radarState.sweepAngle += 0.025;
    const sweepAngle = radarState.sweepAngle % (Math.PI * 2);

    // Sweep trail (fading arc)
    const trailLength = Math.PI * 0.4;
    for (let i = 0; i < 20; i++) {
        const a = sweepAngle - (trailLength * i / 20);
        const opacity = 0.15 * (1 - i / 20);
        ctx.strokeStyle = `rgba(0, 229, 255, ${opacity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
        ctx.stroke();
    }

    // Main sweep line
    const sweepGrad = ctx.createLinearGradient(cx, cy, cx + Math.cos(sweepAngle) * maxR, cy + Math.sin(sweepAngle) * maxR);
    sweepGrad.addColorStop(0, 'rgba(0, 229, 255, 0.6)');
    sweepGrad.addColorStop(1, 'rgba(0, 229, 255, 0.05)');
    ctx.strokeStyle = sweepGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepAngle) * maxR, cy + Math.sin(sweepAngle) * maxR);
    ctx.stroke();

    // ─── Detection blips ───
    const presence = data?.presence || false;
    const movement = data?.movement || false;
    const variance = data?.variance || 0;

    // Generate/update blips based on presence
    if (presence) {
        // Add blip if sweep passes detection zone
        const detectionAngle = Math.PI * 1.2; // Roughly in front
        const angleDiff = Math.abs(((sweepAngle - detectionAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (angleDiff < 0.15 && Math.random() > 0.5) {
            const distance = 0.3 + Math.random() * 0.35;
            const angleVar = detectionAngle + (Math.random() - 0.5) * 0.6;
            radarState.blips.push({
                angle: angleVar,
                distance: distance,
                opacity: 1,
                size: movement ? 6 : 4,
                color: movement ? [255, 171, 0] : [255, 23, 68],
                born: Date.now(),
            });
        }
    }

    // Draw and age blips
    radarState.blips = radarState.blips.filter(b => {
        const age = (Date.now() - b.born) / 1000;
        b.opacity = Math.max(0, 1 - age / 4);

        if (b.opacity <= 0) return false;

        const bx = cx + Math.cos(b.angle) * maxR * b.distance;
        const by = cy + Math.sin(b.angle) * maxR * b.distance;

        // Blip glow
        const glowGrad = ctx.createRadialGradient(bx, by, 0, bx, by, b.size * 3);
        glowGrad.addColorStop(0, `rgba(${b.color.join(',')}, ${b.opacity * 0.4})`);
        glowGrad.addColorStop(1, `rgba(${b.color.join(',')}, 0)`);
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(bx, by, b.size * 3, 0, Math.PI * 2);
        ctx.fill();

        // Blip core
        ctx.fillStyle = `rgba(${b.color.join(',')}, ${b.opacity})`;
        ctx.beginPath();
        ctx.arc(bx, by, b.size * b.opacity, 0, Math.PI * 2);
        ctx.fill();

        return true;
    });

    // ─── Center point ───
    ctx.fillStyle = presence ? (movement ? 'rgba(255, 171, 0, 0.8)' : 'rgba(255, 23, 68, 0.8)') : 'rgba(0, 229, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Center label
    ctx.fillStyle = 'rgba(136, 146, 164, 0.6)';
    ctx.font = '8px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText('SENSOR', cx, cy + 16);

    // ─── Status text ───
    ctx.fillStyle = presence ? (movement ? '#ffab00' : '#ff1744') : '#00e5ff';
    ctx.font = 'bold 10px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(
        movement ? '⚡ MOVIMIENTO DETECTADO' : presence ? '● PRESENCIA DETECTADA' : '○ ÁREA LIMPIA',
        cx, H - 8
    );

    // ─── Outer ring ───
    ctx.strokeStyle = presence ? (movement ? 'rgba(255, 171, 0, 0.3)' : 'rgba(255, 23, 68, 0.3)') : 'rgba(0, 229, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
    ctx.stroke();

    // Cardinal labels
    const cardinals = [['N', -Math.PI/2], ['E', 0], ['S', Math.PI/2], ['O', Math.PI]];
    ctx.fillStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.font = 'bold 9px Inter';
    cardinals.forEach(([l, a]) => {
        ctx.fillText(l, cx + Math.cos(a) * (maxR + 5) - 3, cy + Math.sin(a) * (maxR + 5) + 3);
    });

    ctx.textAlign = 'start';
}

// ═══════════════════════════════════════════════════════════
// Visual Animation Loop (Room + Radar at 30fps)
// ═══════════════════════════════════════════════════════════

let visualAnimFrame = null;

function startVisualLoop() {
    let lastTime = 0;
    const targetInterval = 1000 / 30; // 30 FPS

    function loop(timestamp) {
        if (timestamp - lastTime >= targetInterval) {
            lastTime = timestamp;
            const data = state.lastFrame;
            drawRoomView(data);
            drawRadar(data);
        }
        visualAnimFrame = requestAnimationFrame(loop);
    }
    visualAnimFrame = requestAnimationFrame(loop);
}


function drawHeatmapToCanvas(target) {
    const source = document.getElementById('heatmap-canvas');
    if (!source) return;
    const ctx = target.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(source, 0, 0, target.width, target.height);
}

// ═══════════════════════════════════════════════════════════
// Heatmap — Canvas 2D
// ═══════════════════════════════════════════════════════════

function initHeatmap() {
    const canvas = document.getElementById('heatmap-canvas');
    canvas.width = CONFIG.heatmapHistory;
    canvas.height = CONFIG.numSubcarriers;

    // Inicializar datos del heatmap
    state.heatmapData = [];
}

function updateHeatmap(data) {
    if (!data.amplitudes) return;

    const canvas = document.getElementById('heatmap-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Set internal canvas size to match data dimensions
    const cols = CONFIG.heatmapHistory;
    const rows = CONFIG.numSubcarriers;
    if (canvas.width !== cols || canvas.height !== rows) {
        canvas.width = cols;
        canvas.height = rows;
    }

    // Add data column
    state.heatmapData.push(data.amplitudes);
    if (state.heatmapData.length > cols) {
        state.heatmapData.shift();
    }

    // Draw
    const imgData = ctx.createImageData(cols, rows);

    for (let col = 0; col < state.heatmapData.length; col++) {
        const column = state.heatmapData[col];
        for (let row = 0; row < rows; row++) {
            const value = column[row] || 0;
            const normalized = Math.min(1, value / 40);
            const color = heatmapColor(normalized);
            const pixelIndex = ((rows - 1 - row) * cols + col) * 4;

            imgData.data[pixelIndex] = color[0];
            imgData.data[pixelIndex + 1] = color[1];
            imgData.data[pixelIndex + 2] = color[2];
            imgData.data[pixelIndex + 3] = 255;
        }
    }

    // Fill empty columns
    for (let col = state.heatmapData.length; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
            const pixelIndex = (row * cols + col) * 4;
            imgData.data[pixelIndex] = 13;
            imgData.data[pixelIndex + 1] = 27;
            imgData.data[pixelIndex + 2] = 42;
            imgData.data[pixelIndex + 3] = 255;
        }
    }

    ctx.putImageData(imgData, 0, 0);
}

function heatmapColor(value) {
    // Gradiente: azul oscuro → cyan → verde → amarillo → rojo
    const stops = [
        [0.0, [13, 27, 42]],
        [0.2, [27, 58, 92]],
        [0.4, [0, 131, 143]],
        [0.6, [0, 230, 118]],
        [0.8, [255, 171, 0]],
        [1.0, [255, 23, 68]],
    ];

    let lower = stops[0], upper = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (value >= stops[i][0] && value <= stops[i + 1][0]) {
            lower = stops[i];
            upper = stops[i + 1];
            break;
        }
    }

    const range = upper[0] - lower[0];
    const t = range === 0 ? 0 : (value - lower[0]) / range;

    return [
        Math.round(lower[1][0] + t * (upper[1][0] - lower[1][0])),
        Math.round(lower[1][1] + t * (upper[1][1] - lower[1][1])),
        Math.round(lower[1][2] + t * (upper[1][2] - lower[1][2])),
    ];
}

// ═══════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════

function updateEventsFromFrame(data) {
    if (!data.events) return;

    data.events.forEach(event => {
        const eventId = `${event.type}-${Math.floor(event.timestamp)}`;
        if (!state.events.includes(eventId)) {
            state.events.push(eventId);
            if (state.events.length > 100) state.events.shift();

            if (event.type === 'presence_start') {
                addEvent('presence', `Presencia detectada (var: ${event.variance?.toFixed(1)})`);
            } else if (event.type === 'presence_end') {
                addEvent('clear', `Presencia finalizada`);
            }
        }
    });
}

function addEvent(type, text) {
    const list = document.getElementById('events-list');
    const now = new Date();
    const timeStr = now.toLocaleTimeString('es-AR');

    const item = document.createElement('div');
    item.className = `event-item event-${type}`;
    item.innerHTML = `
        <span class="event-time">${timeStr}</span>
        <span class="event-text">${text}</span>
    `;

    // Insertar al inicio
    list.insertBefore(item, list.firstChild);

    // Limitar eventos
    while (list.children.length > 30) {
        list.removeChild(list.lastChild);
    }
}

// ═══════════════════════════════════════════════════════════
// Settings & Controls
// ═══════════════════════════════════════════════════════════

function initSettings() {
    // Settings overlay (legacy, safe guard)
    const overlay = document.getElementById('settings-overlay');
    if (overlay) overlay.addEventListener('click', () => overlay.classList.remove('active'));

    // Mode buttons
    document.getElementById('btn-demo').addEventListener('click', () => {
        sendMessage({ type: 'mode', mode: 'demo' });
    });

    document.getElementById('btn-live').addEventListener('click', () => {
        sendMessage({ type: 'mode', mode: 'live' });
    });

    // Sliders
    setupSlider('setting-threshold', 'threshold-display', (v) => parseFloat(v).toFixed(1));
    setupSlider('setting-movement', 'movement-display', (v) => parseInt(v));
    setupSlider('setting-sensitivity', 'sensitivity-display', (v) => parseFloat(v).toFixed(2));
    setupSlider('setting-window', 'window-display', (v) => parseInt(v));

    // Debounced config send
    let configTimeout;
    const sendConfig = () => {
        clearTimeout(configTimeout);
        configTimeout = setTimeout(() => {
            sendMessage({
                type: 'config',
                config: {
                    threshold: parseFloat(document.getElementById('setting-threshold').value),
                    movement_threshold: parseFloat(document.getElementById('setting-movement').value),
                    sensitivity: parseFloat(document.getElementById('setting-sensitivity').value),
                    window_size: parseInt(document.getElementById('setting-window').value),
                }
            });
        }, 300);
    };

    ['setting-threshold', 'setting-movement', 'setting-sensitivity', 'setting-window'].forEach(id => {
        document.getElementById(id).addEventListener('input', sendConfig);
    });

    // Serial controls
    document.getElementById('btn-refresh-ports').addEventListener('click', () => {
        sendMessage({ type: 'list_ports' });
    });

    document.getElementById('btn-serial-connect').addEventListener('click', () => {
        const port = document.getElementById('serial-port-select').value;
        sendMessage({ type: 'serial_connect', port: port || null });
    });

    document.getElementById('btn-serial-disconnect').addEventListener('click', () => {
        sendMessage({ type: 'serial_disconnect' });
    });

    // Actions
    document.getElementById('btn-reset').addEventListener('click', () => {
        sendMessage({ type: 'reset' });
        state.heatmapData = [];
        addEvent('info', 'Calibración reiniciada');
    });

    document.getElementById('btn-export').addEventListener('click', exportData);

    document.getElementById('btn-clear-events').addEventListener('click', () => {
        document.getElementById('events-list').innerHTML = '';
        state.events = [];
        addEvent('info', 'Eventos limpiados');
    });
}



function setupSlider(inputId, displayId, formatter) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    input.addEventListener('input', () => {
        display.textContent = formatter(input.value);
    });
}

// ═══════════════════════════════════════════════════════════
// Fullscreen Expand (native resolution rendering)
// ═══════════════════════════════════════════════════════════

let fullscreenSourceId = null;
let fullscreenCanvas = null;

const expandTitles = {
    'room-canvas': '🏠 Vista de Habitación',
    'radar-canvas': '📡 Radar de Detección',
    'amplitude-chart': '📊 Amplitud de Subportadoras',
    'variance-chart': '📈 Varianza (Detección)',
    'heatmap-canvas': '🌡️ Mapa de Calor — Subportadoras',
};

function initExpandButtons() {
    document.querySelectorAll('.expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            openFullscreen(targetId);
        });
    });

    document.getElementById('btn-close-fullscreen').addEventListener('click', closeFullscreen);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeFullscreen();
    });
}

function openFullscreen(canvasId) {
    const modal = document.getElementById('fullscreen-modal');
    const body = document.getElementById('fullscreen-body');
    const title = document.getElementById('fullscreen-title');

    title.textContent = expandTitles[canvasId] || 'Visualización';
    fullscreenSourceId = canvasId;

    body.innerHTML = '';
    fullscreenCanvas = document.createElement('canvas');
    fullscreenCanvas.id = 'fullscreen-canvas';

    const availW = Math.floor(window.innerWidth * 0.92);
    const availH = Math.floor(window.innerHeight * 0.85);

    if (canvasId === 'radar-canvas') {
        const size = Math.min(availW, availH);
        fullscreenCanvas.width = size;
        fullscreenCanvas.height = size;
        fullscreenCanvas.style.width = size + 'px';
        fullscreenCanvas.style.height = size + 'px';
    } else {
        fullscreenCanvas.width = availW;
        fullscreenCanvas.height = availH;
        fullscreenCanvas.style.width = availW + 'px';
        fullscreenCanvas.style.height = availH + 'px';
    }

    body.appendChild(fullscreenCanvas);
    modal.classList.add('active');
}

function closeFullscreen() {
    const modal = document.getElementById('fullscreen-modal');
    modal.classList.remove('active');
    fullscreenCanvas = null;
    fullscreenSourceId = null;
}

// ═══════════════════════════════════════════════════════════
// Export Data
// ═══════════════════════════════════════════════════════════

function exportData() {
    if (!state.lastFrame) {
        addEvent('info', 'No hay datos para exportar');
        return;
    }

    const exportObj = {
        timestamp: new Date().toISOString(),
        mode: state.mode,
        totalFrames: state.frameCount,
        lastFrame: state.lastFrame,
        heatmapData: state.heatmapData,
    };

    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `csi_data_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    addEvent('info', 'Datos exportados correctamente');
}

// ═══════════════════════════════════════════════════════════
// FPS Counter
// ═══════════════════════════════════════════════════════════

function startFPSCounter() {
    setInterval(() => {
        state.fps = state.fpsCounter;
        state.fpsCounter = 0;
    }, 1000);
}

// ═══════════════════════════════════════════════════════════
// Embedded CSI Simulator (runs client-side for static deploy)
// ═══════════════════════════════════════════════════════════

class ClientCSISimulator {
    constructor() {
        this.numSubcarriers = 64;
        this.states = ['empty', 'entering', 'moving', 'still', 'breathing', 'leaving'];
        this.stateIndex = 0;
        this.state = 'empty';
        this.stateStart = Date.now();
        this.stateDuration = this._randRange(5000, 10000);
        this.frameCount = 0;
        this.startTime = Date.now();
        this.breathPhase = 0;
        this.movementPhase = 0;
        this.baseAmplitudes = this._genBaseProfile();

        // Detection state
        this.amplitudeHistory = [];
        this.windowSize = 50;
        this.smoothedVariance = 0;
        this.detectionCount = 0;
        this.presenceFrames = 0;
        this.lastPresence = false;
        this.events = [];
    }

    _randRange(min, max) { return min + Math.random() * (max - min); }
    _gaussian() { return Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random()); }

    _genBaseProfile() {
        const p = [];
        for (let i = 0; i < this.numSubcarriers; i++) {
            const x = (i / this.numSubcarriers) * 2 - 1;
            p.push(20 + 8 * Math.exp(-2 * x * x) + this._gaussian() * 1.5);
        }
        return p;
    }

    _checkTransition() {
        if (Date.now() - this.stateStart >= this.stateDuration) {
            this.stateIndex = (this.stateIndex + 1) % this.states.length;
            this.state = this.states[this.stateIndex];
            this.stateStart = Date.now();
            const durations = { empty: [6000,12000], entering: [2000,3500], moving: [4000,8000], still: [5000,9000], breathing: [6000,12000], leaving: [2000,3500] };
            const d = durations[this.state] || [5000,10000];
            this.stateDuration = this._randRange(d[0], d[1]);
        }
    }

    generateFrame() {
        this._checkTransition();
        this.frameCount++;
        const progress = Math.min(1, (Date.now() - this.stateStart) / this.stateDuration);
        const dt = 0.1;

        const amplitudes = [];
        const perturbation = new Array(this.numSubcarriers).fill(0);
        const center = this.numSubcarriers / 2;

        if (this.state === 'entering') {
            for (let i = 0; i < this.numSubcarriers; i++) {
                const d = (i - center) / 10;
                perturbation[i] = 6 * progress * 0.6 * Math.exp(-0.5 * d * d);
            }
        } else if (this.state === 'moving') {
            this.movementPhase += dt * this._randRange(2, 5);
            const intensity = 0.8 + 0.2 * Math.sin(this.movementPhase);
            for (let i = 0; i < this.numSubcarriers; i++) {
                const d = (i - center + this._randRange(-5,5)) / 10;
                perturbation[i] = 6 * intensity * Math.exp(-0.5 * d * d) + this._gaussian() * 3;
            }
        } else if (this.state === 'still') {
            for (let i = 0; i < this.numSubcarriers; i++) {
                const d = (i - center) / 10;
                perturbation[i] = 3 * Math.exp(-0.5 * d * d) + this._gaussian() * 0.8;
            }
        } else if (this.state === 'breathing') {
            this.breathPhase += dt * 2 * Math.PI * 0.3;
            const breathEffect = 2.5 * Math.sin(this.breathPhase);
            for (let i = 0; i < this.numSubcarriers; i++) {
                const d = (i - center) / 15;
                const mask = Math.exp(-0.5 * d * d);
                perturbation[i] = 2.5 * Math.exp(-0.5 * ((i-center)/10)**2) + breathEffect * mask;
            }
        } else if (this.state === 'leaving') {
            for (let i = 0; i < this.numSubcarriers; i++) {
                const d = (i - center) / 10;
                perturbation[i] = 3 * (1 - progress) * Math.exp(-0.5 * d * d);
            }
        }

        for (let i = 0; i < this.numSubcarriers; i++) {
            amplitudes.push(Math.max(1, Math.min(50, this.baseAmplitudes[i] + this._gaussian() * 1.2 + perturbation[i])));
        }

        // Compute variance
        this.amplitudeHistory.push([...amplitudes]);
        if (this.amplitudeHistory.length > this.windowSize) this.amplitudeHistory.shift();

        let variance = 0;
        if (this.amplitudeHistory.length >= 3) {
            const variances = [];
            for (let s = 0; s < this.numSubcarriers; s++) {
                let sum = 0, sumSq = 0;
                for (const row of this.amplitudeHistory) {
                    sum += row[s]; sumSq += row[s] * row[s];
                }
                const n = this.amplitudeHistory.length;
                variances.push(sumSq/n - (sum/n)**2);
            }
            variance = variances.reduce((a,b) => a+b, 0) / variances.length;
        }
        this.smoothedVariance = 0.3 * variance + 0.7 * this.smoothedVariance;

        const threshold = parseFloat(document.getElementById('setting-threshold')?.value || 12);
        const sensitivity = parseFloat(document.getElementById('setting-sensitivity')?.value || 0.7);
        const movThreshold = parseFloat(document.getElementById('setting-movement')?.value || 25);
        const effThreshold = threshold * (1.5 - sensitivity);
        const effMovThreshold = movThreshold * (1.5 - sensitivity);

        const presence = this.smoothedVariance > effThreshold;
        const movement = this.smoothedVariance > effMovThreshold;

        if (presence && !this.lastPresence) {
            this.detectionCount++;
            this.events.push({ timestamp: Date.now()/1000, type: 'presence_start', variance: this.smoothedVariance });
        } else if (!presence && this.lastPresence) {
            this.events.push({ timestamp: Date.now()/1000, type: 'presence_end', variance: this.smoothedVariance });
        }
        if (this.events.length > 20) this.events.shift();
        this.lastPresence = presence;
        if (presence) this.presenceFrames++;

        const rssi = -55 + (presence ? this._randRange(-8,-3) : 0) + this._randRange(-2,2);
        const uptime = (Date.now() - this.startTime) / 1000;

        return {
            type: 'csi_frame',
            timestamp: Date.now() / 1000,
            frame_number: this.frameCount,
            amplitudes: amplitudes,
            phases: amplitudes.map(() => this._randRange(-Math.PI, Math.PI)),
            rssi: Math.round(rssi),
            noise_floor: -95 + this._randRange(-1,1),
            variance: Math.round(this.smoothedVariance * 100) / 100,
            raw_variance: Math.round(variance * 100) / 100,
            subcarrier_variance: [],
            baseline_deviation: 0,
            presence: presence,
            movement: movement,
            activity_level: movement ? 'movimiento' : presence ? 'presencia' : 'vacío',
            presence_label: movement ? '🔴 Movimiento' : presence ? '🟠 Presencia' : '🟢 Sin Presencia',
            threshold: Math.round(effThreshold * 100) / 100,
            movement_threshold: Math.round(effMovThreshold * 100) / 100,
            stats: {
                avg_amplitude: Math.round(amplitudes.reduce((a,b)=>a+b,0)/amplitudes.length * 100)/100,
                max_amplitude: Math.round(Math.max(...amplitudes) * 100)/100,
                max_variance: Math.round(this.smoothedVariance * 100)/100,
                detection_count: this.detectionCount,
                total_frames: this.frameCount,
                presence_percentage: Math.round(100 * this.presenceFrames / Math.max(1, this.frameCount) * 10)/10,
                uptime: Math.round(uptime * 10)/10,
            },
            events: this.events.slice(-10),
            sim_state: this.state,
        };
    }
}

// ═══════════════════════════════════════════════════════════
// Local Simulator Loop (fallback when no WebSocket)
// ═══════════════════════════════════════════════════════════

let localSimulator = null;
let localSimInterval = null;

function startLocalSimulator() {
    if (localSimInterval) return;

    localSimulator = new ClientCSISimulator();
    updateConnectionStatus('connected', 'Demo Local');
    addEvent('info', '🎮 Simulador local activado (sin servidor)');

    document.getElementById('info-server').textContent = 'Local (navegador)';

    localSimInterval = setInterval(() => {
        const frame = localSimulator.generateFrame();
        handleCSIFrame(frame);
    }, 100); // 10 FPS
}

function stopLocalSimulator() {
    if (localSimInterval) {
        clearInterval(localSimInterval);
        localSimInterval = null;
    }
    localSimulator = null;
}

// ═══════════════════════════════════════════════════════════
// Initialize
// ═══════════════════════════════════════════════════════════

let wsAttempts = 0;
const MAX_WS_ATTEMPTS = 2;

function connectWithFallback() {
    updateConnectionStatus('connecting', 'Conectando...');

    try {
        state.ws = new WebSocket(CONFIG.wsUrl);
    } catch (e) {
        wsAttempts++;
        if (wsAttempts >= MAX_WS_ATTEMPTS) {
            startLocalSimulator();
        } else {
            setTimeout(connectWithFallback, CONFIG.reconnectInterval);
        }
        return;
    }

    const timeout = setTimeout(() => {
        if (state.ws.readyState !== WebSocket.OPEN) {
            state.ws.close();
            wsAttempts++;
            if (wsAttempts >= MAX_WS_ATTEMPTS) {
                startLocalSimulator();
            } else {
                setTimeout(connectWithFallback, CONFIG.reconnectInterval);
            }
        }
    }, 3000);

    state.ws.onopen = () => {
        clearTimeout(timeout);
        wsAttempts = 0;
        state.connected = true;
        stopLocalSimulator();
        updateConnectionStatus('connected', 'Conectado al servidor');
        addEvent('info', 'Conectado al servidor Python');
    };

    state.ws.onclose = () => {
        clearTimeout(timeout);
        state.connected = false;
        wsAttempts++;
        if (wsAttempts >= MAX_WS_ATTEMPTS) {
            startLocalSimulator();
        } else {
            updateConnectionStatus('disconnected', 'Desconectado');
            setTimeout(connectWithFallback, CONFIG.reconnectInterval);
        }
    };

    state.ws.onerror = () => {
        state.connected = false;
    };

    state.ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleMessage(data);
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    };
}

function init() {
    initAmplitudeChart();
    initVarianceChart();
    initHeatmap();
    initRoomView();
    initRadar();
    initSettings();
    initExpandButtons();
    startFPSCounter();
    startVisualLoop();

    // Try WebSocket first, fallback to local simulator
    connectWithFallback();

    // Initialize Supabase features (cameras, persons, config, activity)
    initSupabaseFeatures();

    addEvent('info', 'Dashboard inicializado');
}

// ═══════════════════════════════════════════════════════════
// Supabase CRUD — Cameras, Persons, Config, Activity
// ═══════════════════════════════════════════════════════════

function initSupabaseFeatures() {
    if (!window._supabase) return;

    // RPi heartbeat polling
    pollRpiHeartbeat();
    setInterval(pollRpiHeartbeat, 30000);

    // Cameras page
    loadCameras();
    const addCamBtn = document.getElementById('btn-add-camera');
    if (addCamBtn) addCamBtn.addEventListener('click', () => {
        document.getElementById('modal-add-camera').style.display = '';
    });
    const addCamForm = document.getElementById('form-add-camera');
    if (addCamForm) addCamForm.addEventListener('submit', handleAddCamera);

    // Smart Home — load config + activity + persons summary
    loadSmartHomeConfig();
    loadActivityEvents();
    loadPersonsList();

    // Persons page — full CRUD
    loadPersonsPage();
    const addPersonBtn = document.getElementById('btn-add-person');
    if (addPersonBtn) addPersonBtn.addEventListener('click', () => {
        document.getElementById('modal-add-person').style.display = '';
    });
    const addPersonForm = document.getElementById('form-add-person');
    if (addPersonForm) addPersonForm.addEventListener('submit', handleAddPerson);

    // Activity page — with filters
    loadActivityPage();
    const filterContainer = document.getElementById('activity-filters');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-filter]');
            if (!btn) return;
            filterContainer.querySelectorAll('.filter-btn').forEach(b => {
                b.style.borderColor = 'var(--border)';
                b.style.background = 'transparent';
                b.style.color = 'var(--text-muted)';
                b.classList.remove('active');
            });
            btn.style.borderColor = 'var(--accent-cyan)';
            btn.style.background = 'var(--accent-cyan-dim)';
            btn.style.color = 'var(--accent-cyan)';
            btn.classList.add('active');
            loadActivityPage(btn.dataset.filter);
        });
    }

    // Settings — load full config
    loadSettingsConfig();

    // Settings — save button
    const saveBtn = document.getElementById('btn-save-config');
    if (saveBtn) saveBtn.addEventListener('click', saveFullConfig);

    // Toggle listeners for smart home
    const toggleMap = {
        'toggle-alarm-perimeter': 'alarm_perimeter',
        'toggle-night-mode': 'night_mode',
        'toggle-email-alerts': 'email_alerts',
        'toggle-rf-detection': 'rf_detection_enabled',
        'toggle-camera-recording': 'camera_recording',
        'toggle-siren': 'siren_enabled',
    };
    Object.entries(toggleMap).forEach(([elId, field]) => {
        const el = document.getElementById(elId);
        if (el) el.addEventListener('change', () => saveToggle(field, el.checked));
    });

    // Notifications toggle text update
    const notifToggle = document.getElementById('setting-notifications-enabled');
    if (notifToggle) notifToggle.addEventListener('change', () => {
        const txt = document.getElementById('notif-status-text');
        if (txt) txt.textContent = notifToggle.checked ? 'Las alertas WhatsApp están activas' : 'Todas las alertas están desactivadas';
    });
}

// ─── Cameras CRUD ────────────────────────────────────────

async function loadCameras() {
    const sb = window._supabase;
    const { data } = await sb.from('home_cameras').select('*').order('created_at');
    const grid = document.getElementById('cameras-grid');
    if (!grid) return;

    const cameras = data || [];
    if (cameras.length === 0) {
        grid.innerHTML = `
            <div class="card camera-card" style="display:flex;align-items:center;justify-content:center;min-height:200px;grid-column:1/-1">
                <div style="text-align:center;color:var(--text-muted)">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3" style="margin:0 auto 12px;display:block"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    <p style="font-size:0.9rem;margin-bottom:4px">Sin cámaras configuradas</p>
                    <p style="font-size:0.75rem">Hacé clic en "Agregar Cámara" para empezar</p>
                </div>
            </div>`;
        return;
    }

    grid.innerHTML = cameras.map(cam => `
        <div class="card camera-card">
            <div class="card-header">
                <h3>📷 ${cam.name}</h3>
                <span class="badge ${cam.is_active ? 'badge-live' : ''}">${cam.is_active ? '● ONLINE' : 'OFFLINE'}</span>
            </div>
            <div class="camera-feed">
                <div class="camera-placeholder">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    <p>${cam.location || 'Sin ubicación'}</p>
                    <span class="camera-url">${cam.rtsp_url || 'Sin RTSP'}</span>
                </div>
            </div>
            <div class="camera-info" style="display:flex;justify-content:space-between;align-items:center">
                <span>IP: <strong>${cam.rtsp_url ? cam.rtsp_url.match(/@([\d.]+)/)?.[1] || '—' : '—'}</strong></span>
                <button onclick="deleteCamera('${cam.id}')" style="background:var(--accent-red-dim);color:var(--accent-red);border:none;padding:4px 10px;border-radius:6px;font-size:0.7rem;cursor:pointer;font-weight:600">Eliminar</button>
            </div>
        </div>
    `).join('');
}

async function handleAddCamera(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const ip = fd.get('ip');
    const user = fd.get('username') || 'admin';
    const pass = fd.get('password') || '';
    const channel = fd.get('channel') || '1';
    const rtsp_url = `rtsp://${user}:${pass}@${ip}:554/cam/realmonitor?channel=${channel}&subtype=0`;
    const snapshot_url = `http://${ip}/cgi-bin/snapshot.cgi?channel=${channel}`;

    await window._supabase.from('home_cameras').insert({
        name: fd.get('name'),
        location: fd.get('location'),
        rtsp_url, snapshot_url,
        username: user,
        password: pass,
    });

    document.getElementById('modal-add-camera').style.display = 'none';
    e.target.reset();
    loadCameras();
}

async function deleteCamera(id) {
    if (!confirm('¿Eliminar esta cámara?')) return;
    await window._supabase.from('home_cameras').delete().eq('id', id);
    loadCameras();
}

// ─── Smart Home Config ───────────────────────────────────

async function loadSmartHomeConfig() {
    const { data } = await window._supabase.from('home_config').select('*').eq('id', 'main').single();
    if (!data) return;

    const map = {
        'toggle-alarm-perimeter': data.alarm_perimeter,
        'toggle-night-mode': data.night_mode,
        'toggle-email-alerts': data.email_alerts,
        'toggle-rf-detection': data.rf_detection_enabled,
        'toggle-camera-recording': data.camera_recording,
        'toggle-siren': data.siren_enabled,
    };
    Object.entries(map).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.checked = !!val;
    });
}

async function saveToggle(field, value) {
    await window._supabase.from('home_config').update({
        [field]: value,
        updated_at: new Date().toISOString(),
    }).eq('id', 'main');
}

// ─── Activity Events (Smart Home sidebar) ────────────────

async function loadActivityEvents() {
    const { data } = await window._supabase
        .from('home_presence_events')
        .select('*')
        .order('event_time', { ascending: false })
        .limit(15);

    const container = document.getElementById('sh-activity');
    if (!container) return;

    const events = data || [];
    if (events.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.8rem">Sin eventos registrados aún</div>';
        return;
    }

    container.innerHTML = events.map(evt => {
        const time = new Date(evt.event_time).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const icon = evt.is_known ? '🟢' : '🔴';
        return `<div class="sh-event"><span class="sh-event-time">${time}</span><span class="sh-event-text">${icon} <strong>${evt.person_name}</strong> — ${evt.event_type} ${evt.camera_name ? '(' + evt.camera_name + ')' : ''}</span></div>`;
    }).join('');
}

// ─── Persons List (Smart Home summary) ───────────────────

async function loadPersonsList() {
    const { data } = await window._supabase
        .from('home_persons')
        .select('*')
        .eq('is_active', true)
        .order('name');

    const container = document.getElementById('persons-list');
    const countBadge = document.getElementById('persons-count');
    if (!container) return;

    const persons = data || [];
    if (countBadge) countBadge.textContent = persons.length;

    if (persons.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center">Sin personas registradas</p>';
        return;
    }

    const emojiMap = { familia: '👨‍👩‍👧‍👦', empleada: '🏠', niñera: '👶', visita: '👋' };
    container.innerHTML = persons.map(p => `
        <div class="person-item">
            <div class="person-avatar">${emojiMap[p.relationship] || '👤'}</div>
            <div class="person-info">
                <strong>${p.name}</strong>
                <span>${p.relationship || 'Sin categoría'}${p.phone ? ' • 📱 ' + p.phone : ''}</span>
            </div>
        </div>
    `).join('');
}

// ─── Persons Page (full CRUD + Photos) ───────────────────

async function loadPersonsPage() {
    const { data: persons } = await window._supabase.from('home_persons').select('*').order('name');
    const grid = document.getElementById('persons-grid');
    if (!grid) return;

    const pList = persons || [];
    if (pList.length === 0) {
        grid.innerHTML = `
            <div class="card" style="padding:40px;text-align:center;color:var(--text-muted);grid-column:1/-1">
                <div style="font-size:2.5rem;margin-bottom:8px">👥</div>
                <p style="font-size:0.9rem;margin-bottom:4px">Sin personas registradas</p>
                <p style="font-size:0.75rem">Agregá personas para que el sistema las reconozca</p>
            </div>`;
        return;
    }

    // Load photos with paths
    const { data: photos } = await window._supabase.from('home_person_photos').select('person_id, storage_path');
    const photoCounts = {};
    const photoUrls = {};
    const STORAGE_BASE = window._supabase.supabaseUrl + '/storage/v1/object/public/face-photos/';
    (photos || []).forEach(p => {
        photoCounts[p.person_id] = (photoCounts[p.person_id] || 0) + 1;
        if (!photoUrls[p.person_id]) photoUrls[p.person_id] = STORAGE_BASE + p.storage_path;
    });

    const emojiMap = { familia: '👨‍👩‍👧‍👦', empleada: '🏠', niñera: '👶', visita: '👋' };
    grid.innerHTML = pList.map(p => {
        const pc = photoCounts[p.id] || 0;
        const photoColor = pc > 0 ? 'var(--accent-green)' : 'var(--text-dimmed)';
        const photoBg = pc > 0 ? 'var(--accent-green-dim)' : 'var(--bg-input)';
        const avatarHtml = photoUrls[p.id]
            ? `<img src="${photoUrls[p.id]}" alt="${p.name}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;flex-shrink:0;border:2px solid ${p.is_active ? 'var(--accent-green)' : 'var(--border)'}">`
            : `<div style="width:48px;height:48px;border-radius:12px;background:${p.is_active ? 'var(--accent-green-dim)' : 'var(--bg-input)'};display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">${emojiMap[p.relationship] || '👤'}</div>`;
        return `
        <div class="card" style="padding:16px">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
                ${avatarHtml}
                <div style="flex:1;min-width:0">
                    <strong style="color:var(--text-primary);font-size:0.9rem">${p.name}</strong>
                    <p style="font-size:0.7rem;color:var(--text-muted);text-transform:capitalize">${p.relationship || 'Sin categoría'}</p>
                    ${p.phone ? `<p style="font-size:0.65rem;color:var(--text-dimmed)">📱 ${p.phone}</p>` : ''}
                </div>
                <span style="padding:2px 8px;border-radius:10px;font-size:0.6rem;font-weight:600;${p.is_active ? 'background:var(--accent-green-dim);color:var(--accent-green)' : 'background:var(--bg-input);color:var(--text-muted)'}">${p.is_active ? 'Activa' : 'Inactiva'}</span>
            </div>
            <!-- Photo status -->
            <div style="display:flex;align-items:center;gap:8px;padding:8px;background:${photoBg};border-radius:8px;margin-bottom:10px">
                <span style="font-size:0.75rem">📷</span>
                <span style="flex:1;font-size:0.7rem;color:${photoColor}">${pc} foto${pc !== 1 ? 's' : ''} facial${pc !== 1 ? 'es' : ''}</span>
                ${pc > 0 ? '<span style="color:var(--accent-green)">✓</span>' : ''}
                <label style="padding:3px 8px;border-radius:6px;background:var(--accent-cyan-dim);color:var(--accent-cyan);font-size:0.6rem;font-weight:600;cursor:pointer">
                    📤 Subir foto
                    <input type="file" accept="image/*" onchange="uploadPersonPhoto('${p.id}', this)" style="display:none">
                </label>
            </div>
            <div style="display:flex;gap:6px;padding-top:10px;border-top:1px solid var(--border)">
                <button onclick="togglePersonActive('${p.id}', ${p.is_active})" style="flex:1;padding:6px;border:none;border-radius:6px;background:var(--bg-input);color:var(--text-muted);font-size:0.7rem;cursor:pointer;font-weight:500">${p.is_active ? '👤 Desactivar' : '✅ Activar'}</button>
                <button onclick="deletePerson('${p.id}')" style="padding:6px 10px;border:none;border-radius:6px;background:var(--accent-red-dim);color:var(--accent-red);font-size:0.7rem;cursor:pointer;font-weight:600">✕</button>
            </div>
        </div>`;
    }).join('');
}

async function handleAddPerson(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    await window._supabase.from('home_persons').insert({
        name: fd.get('name'),
        relationship: fd.get('relationship') || null,
        phone: fd.get('phone') || null,
    });
    document.getElementById('modal-add-person').style.display = 'none';
    e.target.reset();
    loadPersonsPage();
    loadPersonsList();
}

async function uploadPersonPhoto(personId, input) {
    const file = input.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop();
    const path = `${personId}/${Date.now()}.${ext}`;

    // Upload to Supabase Storage
    const { error: uploadErr } = await window._supabase.storage
        .from('face-photos')
        .upload(path, file, { contentType: file.type });

    if (uploadErr) {
        alert('Error subiendo foto: ' + uploadErr.message);
        return;
    }

    // Record in home_person_photos
    await window._supabase.from('home_person_photos').insert({
        person_id: personId,
        storage_path: path,
        original_name: file.name,
    });

    input.value = '';
    loadPersonsPage();
}

async function togglePersonActive(id, current) {
    await window._supabase.from('home_persons').update({ is_active: !current }).eq('id', id);
    loadPersonsPage();
    loadPersonsList();
}

async function deletePerson(id) {
    if (!confirm('¿Eliminar esta persona y todas sus fotos?')) return;
    // Delete photos from storage
    const { data: photos } = await window._supabase.from('home_person_photos').select('storage_path').eq('person_id', id);
    if (photos && photos.length > 0) {
        await window._supabase.storage.from('face-photos').remove(photos.map(p => p.storage_path));
        await window._supabase.from('home_person_photos').delete().eq('person_id', id);
    }
    await window._supabase.from('home_persons').delete().eq('id', id);
    loadPersonsPage();
    loadPersonsList();
}

// ─── Activity Page (full with filters) ───────────────────

async function loadActivityPage(filter = 'all') {
    let query = window._supabase
        .from('home_presence_events')
        .select('*')
        .order('event_time', { ascending: false })
        .limit(100);

    if (filter === 'known') query = query.eq('is_known', true);
    if (filter === 'unknown') query = query.eq('is_known', false);

    const { data } = await query;
    const container = document.getElementById('activity-list');
    if (!container) return;

    const events = data || [];
    if (events.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">
            <div style="font-size:2rem;margin-bottom:8px">📋</div>
            <p style="font-size:0.85rem">Sin eventos registrados</p>
        </div>`;
        return;
    }

    container.innerHTML = events.map(evt => {
        const time = new Date(evt.event_time);
        const timeStr = time.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const dateStr = time.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
        const iconBg = evt.is_known ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)';
        const iconColor = evt.is_known ? 'var(--accent-green)' : 'var(--accent-red)';
        const icon = evt.is_known ? '🛡️' : '⚠️';

        return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);transition:background 0.15s" onmouseenter="this.style.background='rgba(255,255,255,0.02)'" onmouseleave="this.style.background='transparent'">
            <div style="width:36px;height:36px;border-radius:10px;background:${iconBg};display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon}</div>
            <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px">
                    <strong style="font-size:0.85rem;color:var(--text-primary)">${evt.person_name}</strong>
                    <span style="font-size:0.65rem;color:${iconColor};font-weight:500">${evt.event_type}</span>
                </div>
                <p style="font-size:0.7rem;color:var(--text-dimmed)">${evt.camera_name || 'Cámara desconocida'}${evt.confidence ? ' • ' + (evt.confidence * 100).toFixed(0) + '% confianza' : ''}</p>
            </div>
            <div style="text-align:right;flex-shrink:0">
                <p style="font-size:0.75rem;color:var(--text-secondary);font-weight:500">${timeStr}</p>
                <p style="font-size:0.6rem;color:var(--text-dimmed)">${dateStr}</p>
            </div>
        </div>`;
    }).join('');
}

// ─── Settings Config (full load + save) ──────────────────

async function loadSettingsConfig() {
    const { data } = await window._supabase.from('home_config').select('*').eq('id', 'main').single();
    if (!data) return;

    // Notifications
    const notifEl = document.getElementById('setting-notifications-enabled');
    if (notifEl) {
        notifEl.checked = !!data.notifications_enabled;
        const txt = document.getElementById('notif-status-text');
        if (txt) txt.textContent = data.notifications_enabled ? 'Las alertas WhatsApp están activas' : 'Todas las alertas están desactivadas';
    }

    // WhatsApp phones
    const phonesEl = document.getElementById('setting-alert-phones');
    if (phonesEl && data.alert_phones) phonesEl.value = data.alert_phones.join('\n');

    // WhatsApp API tokens
    const numIdEl = document.getElementById('setting-whatsapp-number-id');
    if (numIdEl && data.whatsapp_number_id) numIdEl.value = data.whatsapp_number_id;
    const tokenEl = document.getElementById('setting-whatsapp-token');
    if (tokenEl && data.whatsapp_token) tokenEl.value = data.whatsapp_token;

    // Alert toggles
    const unknownEl = document.getElementById('setting-unknown-person-alert');
    if (unknownEl) unknownEl.checked = !!data.unknown_person_alert;
    const phoneAlertEl = document.getElementById('setting-phone-usage-alert');
    if (phoneAlertEl) phoneAlertEl.checked = !!data.phone_usage_alert;

    // Phone detection
    const limitEl = document.getElementById('setting-phone-limit');
    if (limitEl) limitEl.value = data.phone_limit_minutes || 60;
    const intervalEl = document.getElementById('setting-detection-interval');
    if (intervalEl) intervalEl.value = data.detection_interval_seconds || 2;
}

async function saveFullConfig() {
    const btn = document.getElementById('btn-save-config');
    if (btn) { btn.textContent = '⏳ Guardando...'; btn.disabled = true; }

    const phones = (document.getElementById('setting-alert-phones')?.value || '').split('\n').filter(Boolean);

    await window._supabase.from('home_config').update({
        notifications_enabled: document.getElementById('setting-notifications-enabled')?.checked || false,
        alert_phones: phones,
        whatsapp_number_id: document.getElementById('setting-whatsapp-number-id')?.value || null,
        whatsapp_token: document.getElementById('setting-whatsapp-token')?.value || null,
        unknown_person_alert: document.getElementById('setting-unknown-person-alert')?.checked || false,
        phone_usage_alert: document.getElementById('setting-phone-usage-alert')?.checked || false,
        phone_limit_minutes: parseInt(document.getElementById('setting-phone-limit')?.value) || 60,
        detection_interval_seconds: parseInt(document.getElementById('setting-detection-interval')?.value) || 2,
        updated_at: new Date().toISOString(),
    }).eq('id', 'main');

    if (btn) { btn.textContent = '✅ Guardado'; btn.disabled = false; }
    setTimeout(() => { if (btn) btn.textContent = '💾 Guardar Configuración'; }, 2000);
}

// ─── RPi Heartbeat Polling ───────────────────────────────

async function pollRpiHeartbeat() {
    if (!window._supabase) return;
    try {
        const { data } = await window._supabase
            .from('home_heartbeats')
            .select('*')
            .eq('device_id', 'rpi5')
            .order('last_seen', { ascending: false })
            .limit(1)
            .single();

        const widget = document.getElementById('rpi-status-widget');
        if (!widget || !data) return;

        const lastSeen = new Date(data.last_seen);
        const ago = (Date.now() - lastSeen.getTime()) / 1000;
        const isOnline = ago < 120; // 2 min threshold

        const dot = document.getElementById('rpi-dot');
        const icon = document.getElementById('rpi-icon');
        const text = document.getElementById('rpi-status-text');
        const detail = document.getElementById('rpi-status-detail');
        const container = widget.querySelector('div');

        if (isOnline) {
            container.style.background = 'var(--accent-green-dim)';
            dot.style.background = 'var(--accent-green)';
            icon.setAttribute('stroke', 'var(--accent-green)');
            text.style.color = 'var(--accent-green)';
            text.textContent = `RPi5 — Online`;

            const parts = [];
            if (data.cpu_temp) parts.push(`🌡️ ${data.cpu_temp.toFixed(1)}°C`);
            if (data.cameras_processing != null) parts.push(`📹 ${data.cameras_processing} cámaras`);
            if (data.ip_address) parts.push(`📡 ${data.ip_address}`);
            if (data.uptime_seconds) {
                const h = Math.floor(data.uptime_seconds / 3600);
                const m = Math.floor((data.uptime_seconds % 3600) / 60);
                parts.push(`⏱️ ${h}h ${m}m`);
            }
            detail.textContent = parts.join(' • ') || 'Conectado';
        } else {
            container.style.background = 'var(--accent-red-dim)';
            dot.style.background = 'var(--accent-red)';
            icon.setAttribute('stroke', 'var(--accent-red)');
            text.style.color = 'var(--accent-red)';
            text.textContent = 'RPi5 — Offline';
            const minAgo = Math.floor(ago / 60);
            detail.textContent = minAgo > 0 ? `Último contacto hace ${minAgo}min` : 'Sin conexión';
        }
    } catch (e) {
        // Silently fail
    }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
