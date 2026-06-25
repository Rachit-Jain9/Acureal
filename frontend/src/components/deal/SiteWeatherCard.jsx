import { useQuery } from '@tanstack/react-query';
import { Cloud, Droplets, Thermometer, Wind, AlertCircle } from 'lucide-react';
import { SectionHeader } from '../../design-system';

// Open-Meteo is a free, key-free weather API. Forecast-only — no historical
// backfill. Good for construction-planning context: temperature, precipitation,
// wind, and shallow soil moisture (0–7 cm) which flags waterlogging risk.
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

function fetchWeather({ lat, lng }) {
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lng);
  url.searchParams.set('hourly', 'temperature_2m,precipitation,windspeed_10m,soil_moisture_0_to_7cm');
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,windspeed_10m_max');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '7');
  return fetch(url.toString()).then((r) => {
    if (!r.ok) throw new Error('Open-Meteo request failed');
    return r.json();
  });
}

function Stat({ icon: Icon, label, value, hint, accent = 'text-content-secondary' }) {
  return (
    <div className="rounded-lg bg-bg-elevated border border-hairline p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={13} className="text-content-muted" />
        <span className="text-xs text-content-secondary">{label}</span>
      </div>
      <p className={`text-lg font-bold ${accent}`}>{value}</p>
      {hint && <p className="text-xs text-content-muted mt-0.5">{hint}</p>}
    </div>
  );
}

export default function SiteWeatherCard({ lat, lng, city }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['site-weather', lat, lng],
    queryFn: () => fetchWeather({ lat, lng }),
    enabled: lat != null && lng != null,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  if (lat == null || lng == null) return null;

  return (
    <div className="card-editorial">
      <SectionHeader
        size="sm"
        icon={Cloud}
        title="Site Weather & Climate Context"
        sub="7-day forecast for the site location. Helps plan construction windows, monsoon risk, and site-dewatering needs."
        className="mb-4"
      />

      {isLoading && (
        <div className="text-sm text-content-muted py-6 text-center">Loading forecast…</div>
      )}

      {isError && (
        <div className="flex items-start gap-2 bg-premium-soft dark:bg-amber-900/20 border border-hairline dark:border-hairline rounded-lg px-3 py-2.5">
          <AlertCircle size={14} className="text-premium flex-shrink-0 mt-0.5" />
          <p className="text-xs text-premium dark:text-premium">
            Weather data unavailable — the Open-Meteo feed may be rate-limited or offline. This does not block deal work.
          </p>
        </div>
      )}

      {data && (() => {
        const daily = data.daily || {};
        const days = daily.time || [];
        const tMax = daily.temperature_2m_max || [];
        const tMin = daily.temperature_2m_min || [];
        const rain = daily.rain_sum || [];
        const precip = daily.precipitation_sum || [];
        const wind = daily.windspeed_10m_max || [];

        const avgHigh = tMax.length ? (tMax.reduce((a, b) => a + b, 0) / tMax.length).toFixed(1) : '—';
        const avgLow = tMin.length ? (tMin.reduce((a, b) => a + b, 0) / tMin.length).toFixed(1) : '—';
        const totalRain = precip.length ? precip.reduce((a, b) => a + b, 0).toFixed(1) : '0';
        const maxWind = wind.length ? Math.max(...wind).toFixed(0) : '—';
        const heavyRainDays = rain.filter((r) => r > 10).length;

        return (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat
                icon={Thermometer}
                label="Avg High (7d)"
                value={`${avgHigh}°C`}
                hint={`Low ${avgLow}°C`}
                accent="text-premium"
              />
              <Stat
                icon={Droplets}
                label="Rain (7d total)"
                value={`${totalRain} mm`}
                hint={heavyRainDays > 0 ? `${heavyRainDays} heavy-rain day${heavyRainDays > 1 ? 's' : ''}` : 'Light rainfall'}
                accent="text-accent"
              />
              <Stat
                icon={Wind}
                label="Peak Wind"
                value={`${maxWind} km/h`}
                hint="Max daily gust"
                accent="text-accent"
              />
              <Stat
                icon={Cloud}
                label="Location"
                value={city || 'Site'}
                hint={`${Number(lat).toFixed(3)}, ${Number(lng).toFixed(3)}`}
                accent="text-content-secondary"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-bg-secondary border-b border-hairline">
                  <tr>
                    <th className="text-left font-semibold text-content-secondary px-3 py-2">Date</th>
                    <th className="text-right font-semibold text-content-secondary px-3 py-2">High / Low</th>
                    <th className="text-right font-semibold text-content-secondary px-3 py-2">Rain</th>
                    <th className="text-right font-semibold text-content-secondary px-3 py-2">Wind</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {days.map((day, i) => {
                    const rainMm = precip[i] || 0;
                    const isHeavy = rainMm > 10;
                    return (
                      <tr key={day} className="hover:bg-bg-secondary">
                        <td className="px-3 py-2 text-content-secondary">
                          {new Date(day).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </td>
                        <td className="px-3 py-2 text-right text-content-secondary tabular-nums">
                          {tMax[i]?.toFixed(0)}° / {tMin[i]?.toFixed(0)}°
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${isHeavy ? 'text-data-negative dark:text-data-negative font-semibold' : 'text-content-secondary'}`}>
                          {rainMm.toFixed(1)} mm
                        </td>
                        <td className="px-3 py-2 text-right text-content-secondary tabular-nums">
                          {wind[i]?.toFixed(0)} km/h
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-content-muted mt-3">
              Source: open-meteo.com — free, open-data weather feed. Use for construction planning only, not as a legal flood / climate hazard assessment.
            </p>
          </>
        );
      })()}
    </div>
  );
}
