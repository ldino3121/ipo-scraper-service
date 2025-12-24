
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Browser Launcher Helper
async function getBrowser() {
    return await puppeteer.launch({
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ],
        headless: "new"
    });
}

// 1. Scrape Investorgain
app.get('/scrape-investorgain', async (req, res) => {
    console.log("Starting Investorgain Scrape...");
    let browser = null;
    try {
        browser = await getBrowser();
        const page = await browser.newPage();

        // Stealth: Set UA
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto('https://www.investorgain.com/report/live-ipo-gmp/331/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Wait for table
        await page.waitForSelector('#reportData table', { timeout: 15000 });

        const data = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('#reportData table tbody tr'));
            return rows.map(tr => {
                const cells = tr.querySelectorAll('td');
                if (cells.length < 5) return null;

                const nameAnchor = cells[0].querySelector('a');
                const name = nameAnchor ? nameAnchor.innerText.trim() : cells[0].innerText.trim();
                const statusSpan = cells[0].querySelector('span');
                const status = statusSpan ? statusSpan.innerText.trim() : '';

                // Text cleaning could happen here or on client side
                return {
                    ipo_name: name,
                    status_code: status, // U, O, C
                    gmp_raw: cells[1].innerText.trim(),
                    rating: cells[2].innerText.trim(),
                    // sub: cells[3] might be sub
                    price_raw: cells[4].innerText.trim(),
                    // ... extract more as needed
                };
            }).filter(item => item !== null);
        });

        res.json({ success: true, count: data.length, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// 2. Scrape Groww Allotment (for Registrar)
app.get('/scrape-groww', async (req, res) => {
    console.log("Starting Groww Scrape...");
    let browser = null;
    try {
        browser = await getBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto('https://groww.in/ipo/allotment', { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for rows (Groww might be React, so wait for specific content)
        // Table selector guess based on typical structures, or specific class check.
        // Waiting for 'Checkout' buttons or similar.
        // User tip: "Allotment Status header name column"

        // Let's grab specific links with "Check" text
        await page.waitForSelector('table', { timeout: 15000 }); // Assuming a table exists

        const data = await page.evaluate(() => {
            // Locate table rows
            const rows = Array.from(document.querySelectorAll('table tbody tr'));
            return rows.map(tr => {
                const cells = tr.querySelectorAll('td');
                if (cells.length < 2) return null;

                const name = cells[0].innerText.trim();
                // Find Check button/link
                const link = tr.querySelector('a'); // Usually the 'Check' button is an anchor
                return {
                    ipo_name: name,
                    registrar_link: link ? link.href : null
                };
            }).filter(item => item !== null);
        });

        res.json({ success: true, count: data.length, data });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`Scraper Service running on port ${PORT}`);
});
