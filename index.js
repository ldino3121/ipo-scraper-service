
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
            
            // Wait for new table selector (#reportTable) AND ensure it has actual data rows (not just a loading row)
            await page.waitForFunction(() => {
                const rows = document.querySelectorAll('#reportTable tbody tr');
                if (rows.length === 0) return false;
                // Ensure at least one row has more than 10 cells (actual data)
                const firstRowCells = rows[0].querySelectorAll('td');
                return firstRowCells.length >= 11;
            }, { timeout: 30000 });

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

// Debug Endpoint for Investorgain All Tab
app.get('/debug-investorgain', async (req, res) => {
    let browser = null;
    try {
        browser = await getBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.goto('https://www.investorgain.com/report/live-ipo-gmp/331/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('#reportTable tbody tr', { timeout: 30000 });
        
        const debugData = await page.evaluate(() => {
            const table = document.querySelector('#reportTable');
            const rows = document.querySelectorAll('#reportTable tbody tr');
            return {
                html: table ? table.outerHTML.substring(0, 5000) : 'No table',
                rowCount: rows.length,
                firstRowHtml: rows.length > 0 ? rows[0].outerHTML : 'No rows',
                firstRowCellCount: rows.length > 0 ? rows[0].querySelectorAll('td').length : 0
            };
        });
        
        res.json({ success: true, debug: debugData });
    } catch (error) {
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
        // FIX: Do NOT block 'script' — Groww is a React SPA, needs JS to render content
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            const url = req.url().toLowerCase();

            // Block Resource Types (Keep scripts enabled for SPA rendering!)
            if (['image', 'font', 'media'].includes(type) ||
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


        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');


        // Known registrar domains for filtering real registrar links
        const REGISTRAR_DOMAINS = [
            'kfintech.com', 'linkintime.co.in', 'bigshareonline.com',
            'skylinerta.com', 'purvashare.com', 'maashitla.com',
            'cameoindia.com', 'masserv.com', 'mpms.mufg.com',
            'integratedregistry.in', 'ankitonline.com', 'nsdl.co.in'
        ];

        // Helper to scrape allotment page (multi-strategy)
        const scrapeAllotmentPage = async () => {
            try {
                // Wait for React to render content (networkidle2 = 2 or fewer inflight requests)
                await page.waitForFunction(() => {
                    // Look for any external registrar link as a signal that content has loaded
                    const links = document.querySelectorAll('a[href]');
                    return Array.from(links).some(a => 
                        a.href.includes('kfintech') || 
                        a.href.includes('bigshareonline') || 
                        a.href.includes('linkintime') ||
                        a.href.includes('maashitla') ||
                        a.href.includes('mufg.com') ||
                        a.href.includes('skylinerta') ||
                        a.href.includes('purvashare')
                    );
                }, { timeout: 30000 });

                // Scroll down to load lazy content
                await page.evaluate(async () => {
                    await new Promise((resolve) => {
                        let totalHeight = 0;
                        const distance = 400;
                        const timer = setInterval(() => {
                            window.scrollBy(0, distance);
                            totalHeight += distance;
                            if (totalHeight >= document.body.scrollHeight) {
                                clearInterval(timer);
                                resolve();
                            }
                        }, 200);
                        // Safety timeout
                        setTimeout(() => { clearInterval(timer); resolve(); }, 8000);
                    });
                });

                // Small wait after scrolling for lazy content to render
                await new Promise(r => setTimeout(r, 2000));

                // Extract data using multiple strategies
                return await page.evaluate((registrarDomains) => {
                    const results = [];
                    const seen = new Set();

                    // Strategy 1: Try table-based layout (table tbody tr)
                    const tableRows = document.querySelectorAll('table tbody tr');
                    if (tableRows.length > 0) {
                        tableRows.forEach(tr => {
                            const cells = tr.querySelectorAll('td');
                            if (cells.length < 2) return;
                            const name = cells[0].innerText.trim();
                            // Find registrar link in any cell
                            const links = tr.querySelectorAll('a[href]');
                            let regLink = null;
                            links.forEach(a => {
                                const href = a.href.toLowerCase();
                                if (registrarDomains.some(d => href.includes(d))) {
                                    regLink = a.href;
                                }
                            });
                            if (name && !seen.has(name)) {
                                seen.add(name);
                                results.push({ ipo_name: name, registrar_link: regLink });
                            }
                        });
                    }

                    // Strategy 2: If no table rows, find all registrar links and extract parent context
                    if (results.length === 0) {
                        const allLinks = document.querySelectorAll('a[href]');
                        allLinks.forEach(a => {
                            const href = a.href.toLowerCase();
                            const isRegistrar = registrarDomains.some(d => href.includes(d));
                            if (!isRegistrar) return;

                            // Walk up DOM to find the IPO row container
                            let container = a.parentElement;
                            for (let i = 0; i < 6; i++) {
                                if (!container) break;
                                // Look for a container that has substantial text (IPO name)
                                const text = container.innerText || '';
                                // Check if this container looks like an IPO row (has name + check link text)
                                if (text.length > 10 && text.length < 500) {
                                    // Extract just the IPO name (first line or first meaningful text)
                                    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
                                    // The IPO name is typically the first line that isn't "Check" or a status
                                    let ipoName = null;
                                    for (const line of lines) {
                                        if (line.toLowerCase() === 'check' || 
                                            line.toLowerCase() === 'check allotment' ||
                                            line.toLowerCase() === 'check status' ||
                                            line.match(/^(open|closed|upcoming|listed|allotment)$/i)) continue;
                                        ipoName = line;
                                        break;
                                    }
                                    if (ipoName && !seen.has(ipoName)) {
                                        seen.add(ipoName);
                                        results.push({ ipo_name: ipoName, registrar_link: a.href });
                                    }
                                    break;
                                }
                                container = container.parentElement;
                            }
                        });
                    }

                    return results;
                }, REGISTRAR_DOMAINS);

            } catch (e) {
                console.log("Allotment page scrape error:", e.message);
                return [];
            }
        };

        // FIX: Visit ALLOTMENT page (registrar links moved from /ipo/closed to /ipo/allotment)
        console.log("Visiting Groww Allotment page...");
        await page.goto('https://groww.in/ipo/allotment', { waitUntil: 'networkidle2', timeout: 60000 });

        const data = await scrapeAllotmentPage();
        console.log(`Groww Scrape Complete: ${data.length} IPOs with registrar links found.`);
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
