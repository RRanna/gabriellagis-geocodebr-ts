import { useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import './index.css';
import { parseCSVToRows } from './utils/parseCsv';

// Corrige problema de ícones padrão do Leaflet no React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function App() {
  const [inputText, setInputText] = useState(
    'SP, Sao Paulo, Centro, Avenida Paulista, 1578\nSC, Balneario Camboriu, Centro, Avenida Brasil, 800',
  );
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [appendMode, setAppendMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const isCsv = file.name.endsWith('.csv');

      if (isCsv) {
        const rows = parseCSVToRows(text);
        if (rows.length === 0) return;

        const headers = rows[0].map((h) => h.trim().toUpperCase());
        const ufIdx = headers.findIndex((h) => h === 'UF' || h === 'ESTADO');
        const munIdx = headers.findIndex((h) => h === 'MUNICIPIO' || h === 'CIDADE');
        const bairroIdx = headers.findIndex((h) => h === 'BAIRRO' || h === 'LOCALIDADE');
        const logIdx = headers.findIndex(
          (h) => h === 'LOGRADOURO' || h === 'RUA' || h === 'ENDERECO',
        );
        const numIdx = headers.findIndex((h) => h === 'NUMERO' || h === 'NUM');

        const parsedLines = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length <= 1) continue;

          const uf = ufIdx >= 0 ? row[ufIdx] : '';
          const mun = munIdx >= 0 ? row[munIdx] : '';
          const bairro = bairroIdx >= 0 ? row[bairroIdx] : '';
          const log = logIdx >= 0 ? row[logIdx] : '';
          const num = numIdx >= 0 ? row[numIdx] : '';

          parsedLines.push(`${uf}, ${mun}, ${bairro}, ${log}, ${num}`.replace(/,\s*,/g, ','));
        }
        setInputText(parsedLines.join('\n'));
      } else {
        // Simple TXT parsing
        setInputText(text);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleGeocode = async () => {
    setLoading(true);
    try {
      const lines = inputText.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const addresses = lines.map((line) => {
        const parts = line.split(',').map((p) => p.trim());
        let bairro = '';
        let logradouro = '';
        let numero = '';

        if (parts.length >= 5) {
          bairro = parts[2] || '';
          logradouro = parts[3] || '';
          numero = parts[4] || '';
        } else {
          logradouro = parts[2] || '';
          numero = parts[3] || '';
        }

        return {
          estado: parts[0] || '',
          municipio: parts[1] || '',
          bairro,
          logradouro,
          numero,
        };
      });

      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na API');

      if (appendMode && results) {
        setResults([...results, ...data]);
      } else {
        setResults(data);
      }
    } catch (e: any) {
      alert(`Erro: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const exportGeoJSON = () => {
    if (!results || results.length === 0) return;

    const geojson = {
      type: 'FeatureCollection',
      features: results
        .filter((r: any) => r.lat && r.lon)
        .map((r: any) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [r.lon, r.lat],
          },
          properties: { ...r },
        })),
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resultados_geocode.geojson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Define centro do mapa (Brasil como default ou o primeiro ponto)
  const mapCenter =
    results && results.length > 0 && results[0].lat
      ? ([results[0].lat, results[0].lon] as [number, number])
      : ([-14.235, -51.925] as [number, number]);
  const mapZoom = results && results.length > 0 ? 12 : 4;

  return (
    <div className="playground-container">
      <header className="header">
        <a href="https://www.gabriellagis.com" target="_blank" rel="noreferrer">
          <img src="https://www.gabriellagis.com/logo-gabriella-gis.png" alt="Gabriella GIS Logo" />
        </a>
        <div>
          <h1>Geocoding: Encontre a localização geográfica dos endereços</h1>
          <h2>Digite os endereços abaixo, clique em "Geocodificar Lista" e exporte como GeoJSON!</h2>
          <p>
            Powered by{' '}
            <a
              href="https://www.gabriellagis.com"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}
            >
              Gabriella GIS
            </a>
          </p>
        </div>
      </header>

      <section className="input-section">
        <label>Endereços em lote (TXT ou CSV)</label>
        <p style={{ fontSize: '0.875rem', color: 'var(--text)', marginBottom: '1rem' }}>
          Insira linha por linha: <code>Estado, Município, [Bairro], Logradouro, Número</code> ou
          faça upload de um arquivo.
        </p>

        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="SP, Sao Paulo, Copacabana, Avenida Paulista, 1578..."
        />

        <div className="file-upload-wrapper" style={{ justifyContent: 'space-between' }}>
          <div>
            <button className="file-upload-btn" onClick={() => fileInputRef.current?.click()}>
              📎 Carregar Arquivo CSV/TXT
            </button>
            <input type="file" accept=".csv,.txt" ref={fileInputRef} onChange={handleFileUpload} />
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              color: 'var(--text-h)',
              margin: 0,
            }}
          >
            <input
              type="checkbox"
              checked={appendMode}
              onChange={(e) => setAppendMode(e.target.checked)}
              style={{ accentColor: 'var(--primary)', width: '16px', height: '16px' }}
            />
            Mesclar com resultados anteriores
          </label>
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
          <button
            className="btn-primary"
            onClick={handleGeocode}
            disabled={loading || !inputText.trim()}
          >
            {loading ? 'Geocodificando com DuckDB...' : 'Geocodificar Lista'}
          </button>

          {results && results.length > 0 && (
            <button
              className="btn-primary"
              onClick={exportGeoJSON}
              style={{ background: '#10b981', maxWidth: '250px' }}
            >
              🌍 Baixar GeoJSON
            </button>
          )}
        </div>
      </section>

      <section className="results-layout">
        <div className="map-container">
          <MapContainer
            center={mapCenter}
            zoom={mapZoom}
            style={{ height: '100%', width: '100%' }}
            key={mapCenter.join(',')}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Geocoding by <a href="https://www.gabriellagis.com">Gabriella GIS</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {results &&
              results.map((res: any, idx: number) => {
                if (!res.lat || !res.lon) return null;
                return (
                  <Marker key={idx} position={[res.lat, res.lon]}>
                    <Popup>
                      <div style={{ fontFamily: 'var(--sans)' }}>
                        <strong style={{ display: 'block', marginBottom: '5px', color: '#0f172a' }}>
                          {res.endereco_encontrado}
                        </strong>
                        <span
                          style={{
                            fontSize: '12px',
                            background: '#e2e8f0',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            color: '#334155',
                          }}
                        >
                          {res.tipo_resultado}
                        </span>
                        <br />
                        <span
                          style={{
                            fontSize: '11px',
                            color: '#64748b',
                            display: 'block',
                            marginTop: '5px',
                          }}
                        >
                          Precisão: {res.precisao} metros
                        </span>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
          </MapContainer>
        </div>

        <div className="json-panel">
          <h3>Resultados Brutos (JSON)</h3>
          {results ? (
            <pre>{JSON.stringify(results, null, 2)}</pre>
          ) : (
            <p style={{ color: 'var(--text)', fontSize: '0.875rem' }}>
              Execute a geocodificação para ver os dados detalhados.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

export default App;
