
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


// Browser Launcher Helper (Standardized Args)
async function getBrowser() {
    return await puppeteer.launch({
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--single-process'
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

        // OPTIMIZATION: Block heavy resources (Relaxed)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            const url = req.url().toLowerCase();

            // Block Resource Types (ALLOWED SCRIPTS)
            if (['image', 'stylesheet', 'font', 'media'].includes(type) ||
                // Block Ad Domains
                url.includes('googleads') ||
                url.includes('doubleclick') ||
                url.includes('analytics') ||
                url.includes('facebook') ||
                url.includes('twitter')) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Stealth: Set UA
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto('https://www.investorgain.com/report/live-ipo-gmp/331/', { waitUntil: 'domcontentloaded', timeout: 60000 }); // Reduced timeout

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

                return {
                    ipo_name: rawName,
                    type: type,
                    status_code: status,
                    gmp_raw: cells[1].innerText.trim(),
                    rating: cells[2].innerText.trim(),
                    subscription: cells[3].innerText.trim(),
                    price_raw: cells[4].innerText.trim(),
                    issue_size: cells[5].innerText.trim(),
                    lot_size: cells[6].innerText.trim(),
                    open_date: cells[7].innerText.trim(),
                    close_date: cells[8].innerText.trim(),
                    allotment_date: cells[9].innerText.trim(),
                    listing_date: cells[10].innerText.trim(),
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

        // OPTIMIZATION: Block heavy resources & Ads
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            const url = req.url().toLowerCase();

            // Block Resource Types
            if (['image', 'stylesheet', 'font', 'media', 'script'].includes(type) ||
                // Block Ad Domains
                url.includes('googleads') ||
                url.includes('doubleclick') ||
                url.includes('analytics')) {
                req.abort();
            } else {
                req.continue();
            }
        });


        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Helper to scrape current page table
        const scrapeTable = async () => {
            try {
                await page.waitForSelector('table', { timeout: 15000 }); // FAST wait
                return await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('table tbody tr'));
                    return rows.map(tr => {
                        const cells = tr.querySelectorAll('td');
                        if (cells.length < 2) return null;
                        const name = cells[0].innerText.trim();
                        const link = tr.querySelector('a');
                        // Only return if we have a link (to save space)
                        return link ? { ipo_name: name, registrar_link: link.href } : null;
                    }).filter(item => item !== null);
                });
            } catch (e) {
                console.log("No table found or timeout on this page.");
                return [];
            }
        };

        let allData = [];

        // 1. Visit Allotment Page (Active)
        console.log("visiting allotment...");
        await page.goto('https://groww.in/ipo/allotment', { waitUntil: 'domcontentloaded', timeout: 45000 });
        const allotmentData = await scrapeTable();
        allData = [...allData, ...allotmentData];

        // 2. Visit Closed Page (History)
        console.log("visiting closed...");
        await page.goto('https://groww.in/ipo/closed', { waitUntil: 'domcontentloaded', timeout: 45000 });
        const closedData = await scrapeTable();
        allData = [...allData, ...closedData];

        // Deduplicate
        const uniqueData = Array.from(new Map(allData.map(item => [item.ipo_name, item])).values());

        res.json({ success: true, count: uniqueData.length, data: uniqueData });


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
