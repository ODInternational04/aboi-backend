const axios = require('axios');
const supabase = require('../supabase');

class CurrencyService {
    constructor() {
        this.apiUrl = process.env.CURRENCY_API_URL || 'https://api.exchangerate-api.com/v4/latest';
        this.apiKey = process.env.CURRENCY_API_KEY;
        this.fallbackRate = Number(process.env.CURRENCY_FALLBACK_RATE || 0.054);
        this.rateTableCache = new Map();
        this.rateTableTtlMs = Number(process.env.CURRENCY_TABLE_CACHE_TTL_MS || 1000 * 60 * 15);
        this.fallbackBaseFrom = this.normaliseCurrencyCode(process.env.CURRENCY_FALLBACK_BASE_FROM || 'ZAR');
        this.fallbackBaseTo = this.normaliseCurrencyCode(process.env.CURRENCY_FALLBACK_BASE_TO || 'USD');
        this.fallbackInversePrecision = Number(process.env.CURRENCY_FALLBACK_INVERSE_PRECISION || 6);
    }

    adminClient() {
        return supabase.getAdminClient();
    }

    normaliseCurrencyCode(code) {
        return String(code || '').trim().toUpperCase();
    }

    cacheKey(baseCurrency) {
        return this.normaliseCurrencyCode(baseCurrency);
    }

    async fetchExchangeRateFromAPI(fromCurrency, toCurrency) {
        try {
            const url = this.buildLatestUrl(fromCurrency);

            const response = await axios.get(url, {
                timeout: 10000,
                headers: { 'User-Agent': 'ABOI-Backend/1.0' }
            });

            const rate = response.data?.rates?.[toCurrency];
            if (rate) {
                return Number(rate);
            }

            throw new Error(`Rate for ${toCurrency} not found in API response`);
        } catch (error) {
            console.error('Error fetching exchange rate from API:', error.message || error);
            return null;
        }
    }

    async fetchRateTable(fromCurrency) {
        const cacheKey = this.cacheKey(fromCurrency);
        const cached = this.rateTableCache.get(cacheKey);

        if (cached && Date.now() - cached.fetchedAt < this.rateTableTtlMs) {
            return cached.rates;
        }

        try {
            const url = this.buildLatestUrl(fromCurrency);

            const response = await axios.get(url, {
                timeout: 10000,
                headers: { 'User-Agent': 'ABOI-Backend/1.0' }
            });

            if (response.data?.rates && typeof response.data.rates === 'object') {
                this.rateTableCache.set(cacheKey, {
                    fetchedAt: Date.now(),
                    rates: response.data.rates
                });

                return response.data.rates;
            }

            throw new Error('Rate table missing in API response');
        } catch (error) {
            console.error('Error fetching rate table from API:', error.message || error);
            return null;
        }
    }

    buildLatestUrl(fromCurrency) {
        let base = (this.apiUrl || '').trim();

        if (!base) {
            throw new Error('CURRENCY_API_URL is not configured');
        }

        base = base.replace(/\/$/, '');

        // ExchangeRate-API v6 format: https://v6.exchangerate-api.com/v6/<API_KEY>/latest/USD
        if (base.includes('exchangerate-api.com/v6')) {
            if (!this.apiKey) {
                throw new Error('CURRENCY_API_KEY is required for ExchangeRate-API v6');
            }
            return `${base}/${this.apiKey}/latest/${fromCurrency}`;
        }

        // Generic placeholder format e.g. https://example.com/{API_KEY}/latest
        if (base.includes('{API_KEY}')) {
            if (!this.apiKey) {
                throw new Error('CURRENCY_API_KEY is required for the configured API URL');
            }
            return `${base.replace('{API_KEY}', this.apiKey)}/${fromCurrency}`;
        }

        let url = `${base}/${fromCurrency}`;

        if (this.apiKey) {
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}access_key=${this.apiKey}`;
        }

        return url;
    }

    resolveFallbackRate(fromCurrency, toCurrency) {
        if (!this.fallbackRate || !Number.isFinite(this.fallbackRate)) {
            return null;
        }

        const from = this.normaliseCurrencyCode(fromCurrency);
        const to = this.normaliseCurrencyCode(toCurrency);

        if (!from || !to) {
            return null;
        }

        if (from === to) {
            return 1;
        }

        if (from === this.fallbackBaseFrom && to === this.fallbackBaseTo) {
            return Number(this.fallbackRate);
        }

        if (from === this.fallbackBaseTo && to === this.fallbackBaseFrom) {
            const precision = Number.isFinite(this.fallbackInversePrecision) && this.fallbackInversePrecision >= 0
                ? this.fallbackInversePrecision
                : 6;
            return Number((1 / this.fallbackRate).toFixed(precision));
        }

        return null;
    }

    async getCachedExchangeRate(fromCurrency, toCurrency) {
        const from = this.normaliseCurrencyCode(fromCurrency);
        const to = this.normaliseCurrencyCode(toCurrency);

        try {
            const { data, error } = await this.adminClient()
                .from('exchange_rates')
                .select('rate, recorded_at')
                .eq('from_currency', from)
                .eq('to_currency', to)
                .order('recorded_at', { ascending: false })
                .limit(1);

            if (error) {
                throw error;
            }

            if (!data || data.length === 0) {
                return null;
            }

            const cached = data[0];
            const ageHours = (Date.now() - new Date(cached.recorded_at).getTime()) / (1000 * 60 * 60);
            if (ageHours < 4) {
                return Number(cached.rate);
            }

            return null;
        } catch (error) {
            console.error('Error reading cached exchange rate:', error);
            return null;
        }
    }

    async saveExchangeRate(fromCurrency, toCurrency, rate, source = 'api') {
        const from = this.normaliseCurrencyCode(fromCurrency);
        const to = this.normaliseCurrencyCode(toCurrency);

        try {
            const { error } = await this.adminClient()
                .from('exchange_rates')
                .insert({
                    from_currency: from,
                    to_currency: to,
                    rate,
                    source
                });

            if (error) {
                throw error;
            }
        } catch (error) {
            console.error('Error saving exchange rate:', error);
        }
    }

    async getCurrencyRate(fromCurrency = 'ZAR', toCurrency = 'USD') {
        const from = this.normaliseCurrencyCode(fromCurrency);
        const to = this.normaliseCurrencyCode(toCurrency);

        try {
            if (!from || !to) {
                throw new Error('Invalid currency codes supplied');
            }

            if (from === to) {
                return 1;
            }

            const cachedRate = await this.getCachedExchangeRate(from, to);
            if (cachedRate) {
                return cachedRate;
            }

            const apiRate = await this.fetchExchangeRateFromAPI(from, to);
            if (apiRate) {
                await this.saveExchangeRate(from, to, apiRate, 'api');
                return apiRate;
            }

            const { data, error } = await this.adminClient()
                .from('exchange_rates')
                .select('rate')
                .eq('from_currency', from)
                .eq('to_currency', to)
                .order('recorded_at', { ascending: false })
                .limit(1);

            if (!error && data && data.length > 0) {
                console.log('Using stale cached exchange rate');
                return Number(data[0].rate);
            }

            const fallbackResolved = this.resolveFallbackRate(from, to) ?? this.fallbackRate;
            if (!fallbackResolved || !Number.isFinite(fallbackResolved)) {
                throw new Error('Fallback exchange rate unavailable');
            }

            console.log(`Using fallback rate ${fallbackResolved} for ${from}→${to}`);
            await this.saveExchangeRate(from, to, fallbackResolved, 'fallback');
            return fallbackResolved;
        } catch (error) {
            console.error('Error calculating currency rate:', error);
            const fallbackResolved = this.resolveFallbackRate(fromCurrency, toCurrency) ?? this.fallbackRate;
            console.log(`Fallback exchange rate applied: ${fallbackResolved}`);
            return fallbackResolved;
        }
    }

    async getCurrencyRates(fromCurrency = 'USD', targetCurrencies = []) {
        const base = this.normaliseCurrencyCode(fromCurrency);

        if (!Array.isArray(targetCurrencies) || targetCurrencies.length === 0) {
            return {};
        }

        const distinctTargets = [...new Set(
            targetCurrencies
                .filter(Boolean)
                .map((code) => String(code).trim().toUpperCase())
        )];

        const result = {};
        const missingTargets = [];

        await Promise.all(distinctTargets.map(async (target) => {
            const cachedRate = await this.getCachedExchangeRate(base, target);
            if (cachedRate) {
                result[target] = Number(cachedRate);
            } else {
                missingTargets.push(target);
            }
        }));

        if (missingTargets.length > 0) {
            const table = await this.fetchRateTable(base);

            if (table) {
                missingTargets.forEach((target) => {
                    const rate = table[target];
                    if (typeof rate === 'number') {
                        result[target] = Number(rate);
                        this.saveExchangeRate(base, target, rate, 'api_batch').catch((error) => {
                            console.error('Failed to persist batch currency rate:', error);
                        });
                    }
                });
            }
        }

        if (missingTargets.length > 0) {
            const unresolved = missingTargets.filter((code) => result[code] === undefined);

            await Promise.all(unresolved.map(async (target) => {
                const rate = await this.getCurrencyRate(base, target);
                if (rate) {
                    result[target] = Number(rate);
                }
            }));
        }

        return result;
    }

    async convertCurrency(amount, fromCurrency, toCurrency) {
        const from = this.normaliseCurrencyCode(fromCurrency);
        const to = this.normaliseCurrencyCode(toCurrency);

        if (from === to) {
            return Number(amount);
        }

        const rate = await this.getCurrencyRate(from, to);
        return Number((amount * rate).toFixed(4));
    }

    async getExchangeRateHistory(fromCurrency, toCurrency, days = 30) {
        try {
            const sinceDate = new Date();
            sinceDate.setDate(sinceDate.getDate() - Number(days));

            const { data, error } = await this.adminClient()
                .from('exchange_rates')
                .select('rate, recorded_at, source')
                .eq('from_currency', fromCurrency)
                .eq('to_currency', toCurrency)
                .gte('recorded_at', sinceDate.toISOString())
                .order('recorded_at', { ascending: false });

            if (error) {
                throw error;
            }

            return data || [];
        } catch (error) {
            console.error('Error fetching exchange rate history:', error);
            return [];
        }
    }

    async updateFallbackRate(newRate) {
        this.fallbackRate = Number(newRate);
        console.log(`Fallback rate updated to ${this.fallbackRate}`);
        return true;
    }
}

module.exports = new CurrencyService();
