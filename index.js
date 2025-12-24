
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Root Endpoint for Health Check
app.get('/', (req, res) => {
    res.json({ message: "Scraper Service is active 🚀", endpoints: ["/scrape-investorgain", "/scrape-groww"] });
});

// Browser Launcher Helper (Optimized Args)
async function getBrowser() {
    return await puppeteer.launch({
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--single-process' // Sometimes helps on Render
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

        // OPTIMIZATION: Block heavy resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (type === 'image' || type === 'stylesheet' || type === 'font') {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Stealth: Set UA
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto('https://www.investorgain.com/report/live-ipo-gmp/331/', { waitUntil: 'domcontentloaded', timeout: 90000 });

        // Wait for table
        await page.waitForSelector('#reportData table', { timeout: 30000 });

        const data = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('#reportData table tbody tr'));
            return rows.map(tr => {
                const cells = tr.querySelectorAll('td');
                if (cells.length < 11) return null; // Ensure we have enough columns

                // 0: Name + Status + Type
                const nameAnchor = cells[0].querySelector('a');
                let rawName = nameAnchor ? nameAnchor.innerText.trim() : cells[0].innerText.trim();
                const statusSpan = cells[0].querySelector('span');
                const status = statusSpan ? statusSpan.innerText.trim() : '';

                // Detect Type
                let type = "Mainboard";
                if (rawName.includes('SME')) {
                    type = "SME";
                }


                // Indices based on audit:
                // 1: GMP, 2: Rating, 3: Sub, 4: Price, 6: Lot, 7: Open, 8: Close, 9: BoA, 10: Listing
                return {
                    ipo_name: rawName,
                    type: type,
                    status_code: status,
                    gmp_raw: cells[1].innerText.trim(),
                    rating: cells[2].innerText.trim(),
                    subscription: cells[3].innerText.trim(),
                    price_raw: cells[4].innerText.trim(),
                    lot_size: cells[6].innerText.trim(),
                    open_date: cells[7].innerText.trim(),
                    close_date: cells[8].innerText.trim(),
                    allotment_date: cells[9].innerText.trim(),
                    listing_date: cells[10].innerText.trim(),
                    // DEBUG: Dump all cells to verify indices
                    raw_cells: Array.from(cells).map(c => c.innerText.trim())
                };
            }).filter(item => item !== null);
        });

        res.json({ success: true, count: data.length, data });
    } catch (error) {
        console.error("Investorgain Error:", error);
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

        // OPTIMIZATION: Block heavy resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (type === 'image' || type === 'stylesheet' || type === 'font' || type === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto('https://groww.in/ipo/allotment', { waitUntil: 'domcontentloaded', timeout: 90000 });

        // Groww sometimes uses weird tables, wait longer
        await page.waitForSelector('table', { timeout: 30000 });

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
        console.error("Groww Error:", error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`Scraper Service running on port ${PORT}`);
});
