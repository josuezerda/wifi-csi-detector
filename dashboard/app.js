/**
 * WiFi CSI Presence Detector — Dashboard App
 * Visualización en tiempo real de datos CSI con Chart.js y Canvas
 */

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
    const logo = document.getElementById('logo-pulse');

    dot.className = `status-dot ${status}`;
    label.textContent = text;

    if (status === 'connected') {
        logo.classList.add('pulse');
    } else {
        logo.classList.remove('pulse');
    }
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
    const ctx = canvas.getContext('2d');

    // Agregar columna de datos
    state.heatmapData.push(data.amplitudes);
    if (state.heatmapData.length > CONFIG.heatmapHistory) {
        state.heatmapData.shift();
    }

    // Redibujar
    const imgData = ctx.createImageData(canvas.width, canvas.height);

    for (let col = 0; col < state.heatmapData.length; col++) {
        const column = state.heatmapData[col];
        for (let row = 0; row < CONFIG.numSubcarriers; row++) {
            const value = column[row] || 0;
            const normalized = Math.min(1, value / 40); // Normalizar a 0-1
            const color = heatmapColor(normalized);
            const pixelIndex = ((CONFIG.numSubcarriers - 1 - row) * canvas.width + col) * 4;

            imgData.data[pixelIndex] = color[0];
            imgData.data[pixelIndex + 1] = color[1];
            imgData.data[pixelIndex + 2] = color[2];
            imgData.data[pixelIndex + 3] = 255;
        }
    }

    // Rellenar columnas vacías con fondo oscuro
    for (let col = state.heatmapData.length; col < canvas.width; col++) {
        for (let row = 0; row < canvas.height; row++) {
            const pixelIndex = (row * canvas.width + col) * 4;
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
    // Toggle settings panel
    document.getElementById('btn-settings').addEventListener('click', () => {
        document.getElementById('settings-panel').classList.add('open');
        document.getElementById('settings-overlay').classList.add('active');
    });

    document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
    document.getElementById('settings-overlay').addEventListener('click', closeSettings);

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

function closeSettings() {
    document.getElementById('settings-panel').classList.remove('open');
    document.getElementById('settings-overlay').classList.remove('active');
}

function setupSlider(inputId, displayId, formatter) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    input.addEventListener('input', () => {
        display.textContent = formatter(input.value);
    });
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
// Initialize
// ═══════════════════════════════════════════════════════════

function init() {
    initAmplitudeChart();
    initVarianceChart();
    initHeatmap();
    initSettings();
    startFPSCounter();
    connectWebSocket();

    addEvent('info', 'Dashboard inicializado');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
