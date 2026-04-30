
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

        const scrapeInvestorgainUrl = async (url) => {
            console.log(`Navigating to ${url}...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Wait for new table selector (#reportTable) AND ensure it has rows
            await page.waitForSelector('#reportTable tbody tr', { timeout: 30000 });

            return await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('#reportTable tbody tr'));
                return rows.map(tr => {
                    const cells = tr.querySelectorAll('td');
                    if (cells.length < 11) return null;

                    const nameAnchor = cells[0].querySelector('a');
                    let rawName = nameAnchor ? nameAnchor.innerText.trim() : cells[0].innerText.trim();
                    const statusSpan = cells[0].querySelector('span');
                    const status = statusSpan ? statusSpan.innerText.trim() : '';

                    let type = "Mainboard";
                    if (rawName.includes('SME')) {
                        type = "SME";
                    }

                    return {
                        ipo_name: rawName,
                        listing_raw: cells[0].innerText.trim(),
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
        };

        // 1. Scrape "All" View (Upcoming/Open/Closed)
        const allTabItems = await scrapeInvestorgainUrl('https://www.investorgain.com/report/live-ipo-gmp/331/');

        // 2. Scrape "Listed" View (Recently Listed)
        const listedTabItems = await scrapeInvestorgainUrl('https://www.investorgain.com/report/ipo-gmp-live/331/listed/');

        // 3. Merge & Deduplicate by Name
        const combined = [...allTabItems, ...listedTabItems];
        const uniqueData = Array.from(new Map(combined.map(item => [item.ipo_name, item])).values());

        console.log(`Scrape Complete: All=${allTabItems.length}, Listed=${listedTabItems.length}, Unique=${uniqueData.length}`);
        res.json({
            success: true,
            count: uniqueData.length,
            diagnostics: {
                all_count: allTabItems.length,
                listed_count: listedTabItems.length
            },
            data: uniqueData
        });
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
                // Modified: No Auto-Scroll, just wait and scrape
                await page.waitForSelector('table', { timeout: 15000 });
                return await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('table tbody tr'));
                    return rows.map(tr => {
                        const cells = tr.querySelectorAll('td');
                        if (cells.length < 2) return null;
                        const name = cells[0].innerText.trim();
                        const link = tr.querySelector('a');
                        return link ? { ipo_name: name, registrar_link: link.href } : null;
                    }).filter(item => item !== null);
                });
            } catch (e) {
                console.log("No table found or timeout on this page.");
                return [];
            }
        };

        // Simplified Strategy: Visit ONLY Closed Page (As per User Request)
        console.log("visiting closed...");
        await page.goto('https://groww.in/ipo/closed', { waitUntil: 'domcontentloaded', timeout: 30000 });

        const data = await scrapeTable();
        // Return raw data (no need to dedup if single source)
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
