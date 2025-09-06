// Version mit Cookie-Banner Behandlung

const puppeteer = require('puppeteer');
const fs = require('fs').promises;

class BundesligaScraper {
    constructor() {
        this.baseUrl = 'https://www.bundesliga.com/de/bundesliga/spieltag';
        this.currentSeason = '2025-2026';
        this.matches = [];
        this.teams = new Set();
        this.currentSpieltagNumber = null;
    }

    async handleCookieBanner(page) {
        console.log('🍪 Prüfe Cookie-Banner...');
        
        try {
            // Warte auf Cookie-Banner
            await page.waitForSelector('#sp_message_container_893726, .sp_choice_type_11, [id*=\"cookie\"], [class*=\"cookie\"]', { 
                timeout: 5000 
            }).catch(() => console.log('Kein Cookie-Banner gefunden'));

            // Verschiedene Cookie-Button Selektoren probieren
            const cookieSelectors = [
                'button[title*=\"ALLE COOKIES AKZEPTIEREN\"]',
                'button:contains(\"ALLE COOKIES\")',
                'button[class*=\"cookie\"]',
                '.sp_choice_type_11',
                '[title*=\"Akzeptieren\"]',
                '[aria-label*=\"Akzeptieren\"]',
                'button:contains(\"Akzeptieren\")',
                'button:contains(\"Accept\")',
                '#sp_message_container_893726 button'
            ];

            for (let selector of cookieSelectors) {
                try {
                    // Prüfe ob Button existiert
                    const button = await page.$(selector);
                    if (button) {
                        console.log(`✅ Cookie-Button gefunden: ${selector}`);
                        await button.click();
                        console.log('🍪 Cookie-Banner akzeptiert!');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        return true;
                    }
                } catch (error) {
                    // Ignoriere Fehler und probiere nächsten Selector
                }
            }

            // Fallback: Versuche mit JavaScript-Klick
            const clicked = await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (let button of buttons) {
                    const text = button.textContent || button.title || button.getAttribute('aria-label') || '';
                    if (text.toLowerCase().includes('cookie') || 
                        text.toLowerCase().includes('akzeptieren') ||
                        text.toLowerCase().includes('accept') ||
                        text.includes('ALLE')) {
                        button.click();
                        return true;
                    }
                }
                return false;
            });

            if (clicked) {
                console.log('🍪 Cookie-Banner mit JavaScript-Klick akzeptiert!');
                await new Promise(resolve => setTimeout(resolve, 2000));
                return true;
            }

            console.log('⚠️ Cookie-Banner nicht gefunden oder bereits akzeptiert');
            return false;

        } catch (error) {
            console.log('⚠️ Fehler beim Cookie-Banner:', error.message);
            return false;
        }
    }

    async getCurrentSpieltag() {
        console.log('🔍 Ermittle aktuellen Spieltag...');
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            await page.goto(this.baseUrl, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // Cookie-Banner behandeln
            await this.handleCookieBanner(page);

            // Warte auf Inhalt
            await new Promise(resolve => setTimeout(resolve, 3000));

            const spieltagInfo = await page.evaluate(() => {
                const headings = document.querySelectorAll('h1, .heading, [class*=\"spieltag\"]');
                
                for (let heading of headings) {
                    const text = heading.textContent || '';
                    const match = text.match('/(\\d+)\\.\\s*Spieltag/i');
                    if (match) {
                        return {
                            spieltag: parseInt(match[1]),
                            text: text.trim()
                        };
                    }
                }

                const url = window.location.href;
                const urlMatch = url.match('/spieltag\\/\\d{4}-\\d{4}\\/(\\d+)/');
                if (urlMatch) {
                    return {
                        spieltag: parseInt(urlMatch[1]),
                        text: `Spieltag ${urlMatch[1]} (aus URL)`
                    };
                }

                return null;
            });

            if (spieltagInfo) {
                this.currentSpieltagNumber = spieltagInfo.spieltag;
                console.log(`✅ Aktueller Spieltag: ${spieltagInfo.spieltag} (${spieltagInfo.text})`);
            } else {
                console.log('⚠️ Konnte aktuellen Spieltag nicht ermitteln, starte bei Spieltag 3');
                this.currentSpieltagNumber = 3; // Aktuelle Saison startet meist bei 3
            }

        } catch (error) {
            console.error('❌ Fehler beim Ermitteln des Spieltags:', error.message);
            this.currentSpieltagNumber = 3;
        } finally {
            await browser.close();
        }

        return this.currentSpieltagNumber;
    }

    async scrapeAllMatchdays() {
        console.log('🚀 Starte Bundesliga TV-Termine Scraping...');
        
        const startSpieltag = await this.getCurrentSpieltag();
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            let spieltag = startSpieltag;
            let hasMatches = true;
            let consecutiveErrors = 0;

            while (hasMatches && spieltag <= (startSpieltag + 10) && consecutiveErrors < 3) {
                console.log(`📅 Scrape Spieltag ${spieltag}...`);
                
                const url = `${this.baseUrl}/${this.currentSeason}/${spieltag}`;
                
                try {
                    await page.goto(url, { 
                        waitUntil: 'networkidle2',
                        timeout: 30000 
                    });

                    // Cookie-Banner behandeln (falls nötig)
                    await this.handleCookieBanner(page);

                    // Warte auf Inhalt
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    const matches = await this.scrapeMatchday(page, spieltag);
                    
                    if (matches.length === 0) {
                        console.log(`❌ Keine Spiele für Spieltag ${spieltag} gefunden`);
                        consecutiveErrors++;
                    } else {
                        consecutiveErrors = 0;
                        this.matches.push(...matches);
                        
                        matches.forEach(match => {
                            this.teams.add(match.homeTeam);
                            this.teams.add(match.awayTeam);
                        });

                        console.log(`✅ ${matches.length} Spiele für Spieltag ${spieltag} gesammelt`);
                    }

                    spieltag++;
                    await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (error) {
                    console.error(`❌ Fehler bei Spieltag ${spieltag}:`, error.message);
                    consecutiveErrors++;
                    spieltag++;
                }
            }

            console.log(`🎉 Scraping abgeschlossen! ${this.matches.length} Spiele gesammelt.`);

        } finally {
            await browser.close();
        }
    }

    async scrapeMatchday(page, spieltag) {
        try {
            await page.waitForSelector('body', { timeout: 10000 });
            await new Promise(resolve => setTimeout(resolve, 2000));

            const matches = await page.evaluate((spieltag, currentSeason) => {
                const matches = [];
                
                // Erweiterte Selektoren für Bundesliga-Spiele
                const matchSelectors = [
                    'a[href*=\"/liveticker\"]',
                    'a[href*=\"/spieltag/\"]',
                    '.match-item',
                    '.fixture',
                    '[data-testid*=\"match\"]',
                    '[class*=\"match\"]',
                    '.game-item',
                    '[class*=\"fixture\"]'
                ];
                
                let matchElements = [];
                for (let selector of matchSelectors) {
                    matchElements = document.querySelectorAll(selector);
                    if (matchElements.length > 0) {
                        console.log(`Selector funktioniert: ${selector}, Anzahl: ${matchElements.length}`);
                        break;
                    }
                }

                if (matchElements.length === 0) {
                    console.log('Keine Match-Elemente gefunden');
                    // Debug: Zeige verfügbare Links
                    const allLinks = document.querySelectorAll('a');
                    console.log(`Gefunden: ${allLinks.length} Links insgesamt`);
                    return [];
                }

                matchElements.forEach((matchEl, index) => {
                    try {
                        const allText = matchEl.textContent || '';
                        
                        // Zeit extrahieren
                        let timeText = '15:30';
                        const timeMatch = allText.match(/(\\d{1,2}:\\d{2})/);
                        if (timeMatch) {
                            timeText = timeMatch[1];
                        }

                        // Teams extrahieren - verschiedene Methoden
                        let homeTeam = '';
                        let awayTeam = '';
                        
                        // Methode 1: Bekannte Teams direkt suchen
                        const knownTeams = [
                            'Bayern München', 'FC Bayern München', 'Bayern',
                            'Borussia Dortmund', 'BVB', 'Dortmund',
                            'RB Leipzig', 'Leipzig',
                            'Bayer Leverkusen', 'Bayer 04 Leverkusen', 'Leverkusen',
                            'Borussia Mönchengladbach', 'Mönchengladbach', 'Gladbach',
                            'VfL Wolfsburg', 'Wolfsburg',
                            'Eintracht Frankfurt', 'Frankfurt',
                            'TSG Hoffenheim', 'Hoffenheim',
                            'SC Freiburg', 'Sport-Club Freiburg', 'Freiburg',
                            'Union Berlin', '1. FC Union Berlin',
                            'VfB Stuttgart', 'Stuttgart',
                            'Werder Bremen', 'SV Werder Bremen', 'Bremen',
                            'FC Augsburg', 'Augsburg',
                            'Mainz 05', '1. FSV Mainz 05', 'Mainz',
                            'FC Köln', '1. FC Köln', 'Köln',
                            'FC St. Pauli', 'St. Pauli',
                            'Hamburger SV', 'HSV', 'Hamburg',
                            'Heidenheim', '1. FC Heidenheim'
                        ];
                        
                        const foundTeams = knownTeams.filter(team => 
                            allText.includes(team) && team.length > 3
                        ).sort((a, b) => b.length - a.length); // Längere Namen zuerst

                        if (foundTeams.length >= 2) {
                            homeTeam = foundTeams[0];
                            awayTeam = foundTeams[1];
                            
                            // Prüfe ob es verschiedene Teams sind
                            if (homeTeam.includes(awayTeam) || awayTeam.includes(homeTeam)) {
                                if (foundTeams.length >= 3) {
                                    awayTeam = foundTeams[2];
                                }
                            }
                        }

                        // Broadcaster extrahieren - verbesserte Methode
                        let broadcaster = 'Unbekannt';
                        
                        // Methode 1: IMG-Tags mit alt-Attribut prüfen
                        const broadcasterImgs = matchEl.querySelectorAll('img');
                        for (let img of broadcasterImgs) {
                            const alt = (img.alt || '').toLowerCase();
                            const src = (img.src || '').toLowerCase();
                            
                            if (alt.includes('sky') || src.includes('sky')) {
                                broadcaster = 'Sky Deutschland';
                                break;
                            } else if (alt.includes('dazn') || src.includes('dazn')) {
                                broadcaster = 'DAZN';
                                break;
                            } else if (alt.includes('wow') || src.includes('wow')) {
                                broadcaster = 'WOW';
                                break;
                            } else if (alt.includes('sport1') || src.includes('sport1')) {
                                broadcaster = 'Sport1';
                                break;
                            } else if (alt.includes('rtl') || src.includes('rtl')) {
                                broadcaster = 'RTL+';
                                break;
                            }
                        }
                        
                        // Methode 2: Text-Suche als Fallback
                        if (broadcaster === 'Unbekannt') {
                            const lowerText = allText.toLowerCase();
                            if (lowerText.includes('sky deutschland') || lowerText.includes('sky')) {
                                broadcaster = 'Sky Deutschland';
                            } else if (lowerText.includes('dazn')) {
                                broadcaster = 'DAZN';
                            } else if (lowerText.includes('wow')) {
                                broadcaster = 'WOW';
                            } else if (lowerText.includes('sport1')) {
                                broadcaster = 'Sport1';
                            } else if (lowerText.includes('rtl')) {
                                broadcaster = 'RTL+';
                            } else if (lowerText.includes('ard')) {
                                broadcaster = 'Das Erste';
                            } else if (lowerText.includes('zdf')) {
                                broadcaster = 'ZDF';
                            }
                        }
                        
                        // Methode 3: Suche in parent-Elementen
                        if (broadcaster === 'Unbekannt') {
                            let parentEl = matchEl.parentElement;
                            let attempts = 0;
                            while (parentEl && attempts < 3) {
                                const parentText = (parentEl.textContent || '').toLowerCase();
                                const parentImgs = parentEl.querySelectorAll('img');
                                
                                for (let img of parentImgs) {
                                    const alt = (img.alt || '').toLowerCase();
                                    if (alt.includes('sky')) { broadcaster = 'Sky Deutschland'; break; }
                                    if (alt.includes('dazn')) { broadcaster = 'DAZN'; break; }
                                    if (alt.includes('wow')) { broadcaster = 'WOW'; break; }
                                }
                                
                                if (broadcaster !== 'Unbekannt') break;
                                parentEl = parentEl.parentElement;
                                attempts++;
                            }
                        }

                        if (homeTeam && awayTeam && homeTeam !== awayTeam) {
                            const now = new Date();
                            const matchDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (spieltag * 7) + index);
                            
                            if (timeText) {
                                const [hours, minutes] = timeText.split(':');
                                matchDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                            }

                            matches.push({
                                spieltag: spieltag,
                                homeTeam: homeTeam,
                                awayTeam: awayTeam,
                                date: matchDate.toISOString(),
                                dateFormatted: matchDate.toLocaleDateString('de-DE', {
                                    weekday: 'long',
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric'
                                }),
                                kickoff: timeText,
                                broadcaster: broadcaster,
                                season: currentSeason,
                                url: window.location.href,
                                debug: allText.substring(0, 100)
                            });
                        }

                    } catch (error) {
                        console.log('Fehler beim Parsen:', error);
                    }
                });

                return matches;
            }, spieltag, this.currentSeason);

            return matches;

        } catch (error) {
            console.error(`Fehler beim Scrapen von Spieltag ${spieltag}:`, error);
            return [];
        }
    }

    async saveToJSON(filename = 'bundesliga-tv-termine.json') {
        const output = {
            lastUpdated: new Date().toISOString(),
            season: this.currentSeason,
            currentSpieltag: this.currentSpieltagNumber,
            totalMatches: this.matches.length,
            teams: Array.from(this.teams).sort(),
            matches: this.matches.sort((a, b) => new Date(a.date) - new Date(b.date))
        };

        try {
            await fs.writeFile(filename, JSON.stringify(output, null, 2), 'utf8');
            console.log(`💾 Daten gespeichert in ${filename}`);
            console.log(`📊 ${output.totalMatches} Spiele, ${output.teams.length} Teams`);
            console.log(`🎯 Aktueller Spieltag: ${output.currentSpieltag}`);
            
            if (output.matches.length > 0) {
                console.log('\
📅 Erste 3 Spiele:');
                output.matches.slice(0, 3).forEach(match => {
                    console.log(`   ${match.homeTeam} vs ${match.awayTeam} - ${match.kickoff} (${match.broadcaster})`);
                });
            }
            
        } catch (error) {
            console.error('❌ Fehler beim Speichern:', error);
        }
    }

    // Debug-Methode mit Cookie-Behandlung
    async debugCurrentPage() {
        console.log('🔍 Debug-Modus: Browser wird geöffnet...');
        
        const browser = await puppeteer.launch({
            headless: false, // Browser sichtbar
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            devtools: false
        });

        try {
            const page = await browser.newPage();
            await page.setViewport({ width: 1200, height: 800 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            console.log('📡 Lade Bundesliga-Seite...');
            await page.goto(this.baseUrl, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            console.log('🍪 Behandle Cookie-Banner...');
            await this.handleCookieBanner(page);

            console.log('⏳ Warte auf Seiten-Inhalt...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            const pageInfo = await page.evaluate(() => {
                return {
                    title: document.title,
                    url: window.location.href,
                    h1: document.querySelector('h1')?.textContent || 'Keine H1',
                    liveticker: document.querySelectorAll('a[href*=\"/liveticker\"]').length,
                    allLinks: document.querySelectorAll('a').length,
                    bodyText: document.body.textContent.substring(0, 1000)
                };
            });

            console.log('\
📋 Seiten-Info nach Cookie-Behandlung:');
            console.log(`Titel: ${pageInfo.title}`);
            console.log(`URL: ${pageInfo.url}`);
            console.log(`H1: ${pageInfo.h1}`);
            console.log(`Liveticker-Links: ${pageInfo.liveticker}`);
            console.log(`Alle Links: ${pageInfo.allLinks}`);
            console.log(`\
📝 Seitentext (erste 1000 Zeichen):`);
            console.log(pageInfo.bodyText);

            console.log('\
🛠️ Browser bleibt offen - untersuche die Seite!');
            console.log('💡 Drücke Strg+C um zu beenden');
            
            // Halte Browser offen
            process.on('SIGINT', async () => {
                console.log('\
👋 Schließe Browser...');
                await browser.close();
                process.exit(0);
            });

            await new Promise(() => {});

        } catch (error) {
            console.error('❌ Debug-Fehler:', error);
            await browser.close();
        }
    }
}

// CLI Handling
async function main() {
    const args = process.argv.slice(2);
    const scraper = new BundesligaScraper();
    
    try {
        if (args.includes('--debug')) {
            await scraper.debugCurrentPage();
        } else {
            await scraper.scrapeAllMatchdays();
            await scraper.saveToJSON();
        }
    } catch (error) {
        console.error('❌ Fehler:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { BundesligaScraper };