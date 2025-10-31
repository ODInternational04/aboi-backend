const express = require('express');
const currencyService = require('../services/currencyService');

const router = express.Router();

// Get current exchange rate
router.get('/rate', async (req, res) => {
    try {
        const { from = 'ZAR', to = 'USD' } = req.query;

        const rate = await currencyService.getCurrencyRate(from, to);

        res.json({
            success: true,
            data: {
                from_currency: from,
                to_currency: to,
                rate: rate,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Get exchange rate error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch exchange rate' }
        });
    }
});

router.get('/rates', async (req, res) => {
    try {
        const baseCurrency = (req.query.base || 'USD').toString().toUpperCase();
        const symbolsParam = req.query.symbols;

        const symbols = typeof symbolsParam === 'string'
            ? symbolsParam.split(',').map((code) => code.trim()).filter(Boolean)
            : Array.isArray(symbolsParam)
                ? symbolsParam.map((code) => String(code).trim()).filter(Boolean)
                : [];

        if (symbols.length === 0) {
            return res.status(400).json({
                error: { message: 'At least one target currency symbol is required' }
            });
        }

        const rates = await currencyService.getCurrencyRates(baseCurrency, symbols);

        res.json({
            success: true,
            data: {
                base_currency: baseCurrency,
                rates,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Batch exchange rate error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch batch exchange rates' }
        });
    }
});

// Convert currency amount
router.get('/convert', async (req, res) => {
    try {
        const { amount, from = 'ZAR', to = 'USD' } = req.query;

        if (!amount || isNaN(amount)) {
            return res.status(400).json({
                error: { message: 'Valid amount is required' }
            });
        }

        const convertedAmount = await currencyService.convertCurrency(parseFloat(amount), from, to);
        const rate = await currencyService.getCurrencyRate(from, to);

        res.json({
            success: true,
            data: {
                original_amount: parseFloat(amount),
                converted_amount: convertedAmount,
                from_currency: from,
                to_currency: to,
                exchange_rate: rate,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Currency conversion error:', error);
        res.status(500).json({
            error: { message: 'Failed to convert currency' }
        });
    }
});

// Get exchange rate history
router.get('/history', async (req, res) => {
    try {
        const { from = 'ZAR', to = 'USD', days = 30 } = req.query;

        const history = await currencyService.getExchangeRateHistory(from, to, parseInt(days));

        res.json({
            success: true,
            data: {
                from_currency: from,
                to_currency: to,
                period_days: parseInt(days),
                history: history
            }
        });

    } catch (error) {
        console.error('Get exchange rate history error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch exchange rate history' }
        });
    }
});

// Get supported currencies
router.get('/supported', (req, res) => {
    try {
        const supportedCurrencies = [
            { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
            { code: 'USD', name: 'US Dollar', symbol: '$' },
            { code: 'EUR', name: 'Euro', symbol: '€' },
            { code: 'GBP', name: 'British Pound', symbol: '£' }
        ];

        res.json({
            success: true,
            data: supportedCurrencies
        });

    } catch (error) {
        console.error('Get supported currencies error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch supported currencies' }
        });
    }
});

module.exports = router;
