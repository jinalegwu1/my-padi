import Ionicons from '@expo/vector-icons/Ionicons';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import type { ComponentProps } from 'react';

export type WeatherReport = {
  location: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  precipitation: number;
  uvIndex: number;
  weatherCode: number;
  isDay: boolean;
  localTime: string;
};

type NominatimResponse = {
  name?: string;
  address?: {
    county?: string;
    city_district?: string;
    state_district?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    region?: string;
    country?: string;
    country_code?: string;
  };
};

type Coordinates = { latitude: number; longitude: number };

export type LocalAddress = {
  district: string | null;
  subregion: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  isoCountryCode: string | null;
  name: string | null;
};

type GeocodingResult = Coordinates & {
  name: string;
  country?: string;
  admin1?: string;
};

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    precipitation?: number;
    uv_index?: number;
    weather_code?: number;
    is_day?: number;
    time?: string;
  };
  timezone?: string;
};

const REQUEST_TIMEOUT_MS = 12_000;
let lastWebGeocodeStartedAt = 0;
let webAreaCache: { key: string; address: LocalAddress } | undefined;

export async function fetchWeatherForCoordinates(
  coordinates: Coordinates,
  location: string,
): Promise<WeatherReport> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(roundCoordinate(coordinates.latitude)));
  url.searchParams.set('longitude', String(roundCoordinate(coordinates.longitude)));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,uv_index,weather_code,wind_speed_10m',
  );
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('precipitation_unit', 'mm');
  url.searchParams.set('timezone', 'auto');

  const payload = await requestJSON<OpenMeteoResponse>(url);
  const current = payload.current;
  if (
    !current ||
    !isFiniteNumber(current.temperature_2m) ||
    !isFiniteNumber(current.apparent_temperature) ||
    !isFiniteNumber(current.relative_humidity_2m) ||
    !isFiniteNumber(current.wind_speed_10m) ||
    !isFiniteNumber(current.precipitation) ||
    !isFiniteNumber(current.uv_index) ||
    !isFiniteNumber(current.weather_code) ||
    typeof current.is_day !== 'number' ||
    typeof current.time !== 'string'
  ) {
    throw new Error('The weather service returned incomplete weather data. Please try again.');
  }

  return {
    location,
    temperature: current.temperature_2m,
    feelsLike: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    windSpeed: current.wind_speed_10m,
    precipitation: current.precipitation,
    uvIndex: current.uv_index,
    weatherCode: current.weather_code,
    isDay: current.is_day === 1,
    localTime: current.time,
  };
}

export async function geocodeCity(query: string): Promise<GeocodingResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('Enter a city or town to look up its weather.');
  }
  if (trimmed.length > 100) {
    throw new Error('Please keep the location name under 100 characters.');
  }

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', trimmed);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const payload = await requestJSON<{ results?: GeocodingResult[] }>(url);
  const result = payload.results?.[0];
  if (!result || !isFiniteNumber(result.latitude) || !isFiniteNumber(result.longitude)) {
    throw new Error('We could not find that place. Check the spelling or try a nearby city.');
  }
  return result;
}

export async function reverseGeocodeCoordinates(
  coordinates: Coordinates,
): Promise<LocalAddress> {
  const approximate = {
    latitude: roundGeocodeCoordinate(coordinates.latitude, 90),
    longitude: roundGeocodeCoordinate(coordinates.longitude, 180),
  };

  if (Platform.OS !== 'web') {
    const [address] = await Location.reverseGeocodeAsync(approximate);
    if (!address) {
      throw new Error('PADI could not identify your country and local area. Please try again.');
    }
    return {
      district: address.district,
      subregion: address.subregion,
      city: address.city,
      region: address.region,
      country: address.country,
      isoCountryCode: address.isoCountryCode,
      name: address.name,
    };
  }

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(approximate.latitude));
  url.searchParams.set('lon', String(approximate.longitude));
  url.searchParams.set('zoom', '10');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'en');
  const cacheKey = `${approximate.latitude},${approximate.longitude}`;
  if (webAreaCache?.key === cacheKey) return webAreaCache.address;

  const delay = Math.max(0, 1000 - (Date.now() - lastWebGeocodeStartedAt));
  if (delay > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
  lastWebGeocodeStartedAt = Date.now();
  const payload = await requestJSON<NominatimResponse>(url, 'area lookup');
  const address = payload.address;
  if (!address) {
    throw new Error('PADI could not identify your country and local area. Please try again.');
  }

  const localAddress: LocalAddress = {
    district: address.county ?? address.city_district ?? null,
    subregion: address.state_district ?? null,
    city: address.city ?? address.town ?? address.village ?? address.municipality ?? null,
    region: address.state ?? address.region ?? null,
    country: address.country ?? null,
    isoCountryCode: address.country_code?.toUpperCase() ?? null,
    name: payload.name ?? null,
  };
  webAreaCache = { key: cacheKey, address: localAddress };
  return localAddress;
}

export function roundCoordinate(coordinate: number): number {
  if (!Number.isFinite(coordinate) || coordinate < -180 || coordinate > 180) {
    throw new Error('The device returned an invalid location.');
  }
  return Math.round(coordinate * 10) / 10;
}

function roundGeocodeCoordinate(coordinate: number, max: number): number {
  if (!Number.isFinite(coordinate) || coordinate < -max || coordinate > max) {
    throw new Error('The device returned an invalid location.');
  }
  return Math.round(coordinate * 100) / 100;
}

export function weatherDescription(code: number): {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
} {
  if (code === 0) return { label: 'Clear sky', icon: 'sunny-outline' };
  if (code <= 3) return { label: 'Partly cloudy', icon: 'partly-sunny-outline' };
  if (code === 45 || code === 48) return { label: 'Foggy', icon: 'cloud-outline' };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: 'Light drizzle', icon: 'rainy-outline' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: 'Rain', icon: 'rainy-outline' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: 'Snow', icon: 'snow-outline' };
  if ([95, 96, 99].includes(code)) return { label: 'Thunderstorm', icon: 'thunderstorm-outline' };
  return { label: 'Current conditions', icon: 'cloud-outline' };
}

export function weatherSuggestion(
  report: Pick<WeatherReport, 'weatherCode' | 'feelsLike' | 'precipitation' | 'uvIndex'>,
): string {
  if ([95, 96, 99].includes(report.weatherCode)) {
    return 'Thunderstorms may be nearby. Consider checking local official alerts before heading out.';
  }
  if (
    report.precipitation > 0 ||
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(report.weatherCode)
  ) {
    return 'Looks wet nearby. If you are heading out, you may want to bring an umbrella.';
  }
  if (report.feelsLike >= 35 || report.uvIndex >= 8) {
    return 'It feels hot outside. If you will be out for a while, water and shade may help you stay comfortable.';
  }
  return 'That is the weather around you right now. Hope it helps you plan your day.';
}

export function buildSpokenGreeting(
  report: WeatherReport,
  displayName: string,
  languageCode: string,
): string {
  const hour = Number(report.localTime.slice(11, 13));
  const timeOfDay = hour >= 5 && hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const name = displayName.trim();
  const condition = spokenWeatherCondition(report.weatherCode, languageCode);
  const weatherNote = greetingWeatherNote(report);

  if (languageCode === 'pcm-NG') {
    const time = { morning: 'mornin', afternoon: 'afternoon', evening: 'evening' }[timeOfDay];
    return `Good ${time}${name ? `, ${name}` : ''}! Na me be PADI. E be ${condition} for ${report.location}, and e dey feel like ${Math.round(report.feelsLike)} degrees. ${weatherNote.pcm}`;
  }

  if (languageCode === 'fr-FR') {
    const greeting = timeOfDay === 'evening' ? 'Bonsoir' : 'Bonjour';
    return `${greeting}${name ? `, ${name}` : ''} ! Je suis PADI. À ${report.location}, le temps est ${condition} et la température ressentie est de ${Math.round(report.feelsLike)} degrés. ${weatherNote.fr}`;
  }

  const greeting = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' }[
    timeOfDay
  ];
  return `${greeting}${name ? `, ${name}` : ''}! I’m PADI. It is ${condition} in ${report.location}, and it feels like ${Math.round(report.feelsLike)} degrees. ${weatherNote.en}`;
}

function spokenWeatherCondition(weatherCode: number, languageCode: string): string {
  const english = weatherDescription(weatherCode).label.toLowerCase();
  if (languageCode === 'pcm-NG') {
    if (weatherCode === 0) return 'sky clear';
    if (weatherCode <= 3) return 'cloud dey small';
    if (weatherCode === 45 || weatherCode === 48) return 'foggy';
    if ([51, 53, 55, 56, 57].includes(weatherCode)) return 'small rain';
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) return 'rain';
    if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return 'snow';
    if ([95, 96, 99].includes(weatherCode)) return 'thunderstorm';
    return 'weather';
  }
  if (languageCode === 'fr-FR') {
    if (weatherCode === 0) return 'dégagé';
    if (weatherCode <= 3) return 'partiellement nuageux';
    if (weatherCode === 45 || weatherCode === 48) return 'brumeux';
    if ([51, 53, 55, 56, 57].includes(weatherCode)) return 'pluvieux avec de la bruine';
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) return 'pluvieux';
    if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return 'neigeux';
    if ([95, 96, 99].includes(weatherCode)) return 'orageux';
  }
  return english;
}

function greetingWeatherNote(report: WeatherReport): { en: string; pcm: string; fr: string } {
  if ([95, 96, 99].includes(report.weatherCode)) {
    return {
      en: 'Thunderstorms may be nearby, so please check local official alerts if you are heading out.',
      pcm: 'Thunderstorm fit dey near, so check local official alert if you wan go out.',
      fr: 'Des orages sont possibles. Consultez les alertes locales officielles avant de sortir.',
    };
  }
  if (
    report.uvIndex >= 8 ||
    report.feelsLike >= 35 ||
    ([0, 1].includes(report.weatherCode) && report.feelsLike >= 32)
  ) {
    return {
      en: 'It is hot or sunny, so take it easy, drink some water, and look for shade if you are outside.',
      pcm: 'Sun dey hot, take am easy, drink water, and find shade if you dey outside.',
      fr: 'Il fait chaud ou le soleil est fort : pensez à boire de l’eau et à chercher de l’ombre.',
    };
  }
  if (
    report.precipitation > 0 ||
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(report.weatherCode)
  ) {
    return {
      en: 'It looks wet outside, so you may want to take an umbrella.',
      pcm: 'Rain dey, so you fit carry umbrella.',
      fr: 'Il risque de pleuvoir ; un parapluie pourrait être utile.',
    };
  }
  return {
    en: 'I hope your day is going well. What would you like to talk about?',
    pcm: 'I hope say your day dey go well. Wetin you wan gist about?',
    fr: 'J’espère que votre journée se passe bien. De quoi aimeriez-vous parler ?',
  };
}

async function requestJSON<T>(url: URL, service = 'weather'): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`The ${service} service is unavailable right now (HTTP ${response.status}).`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`The ${service} request took too long. Check your connection and try again.`);
    }
    if (error instanceof Error && error.message.startsWith(`The ${service} service`)) {
      throw error;
    }
    throw new Error(`Could not reach the ${service} service. Check your connection and try again.`);
  } finally {
    clearTimeout(timeout);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
