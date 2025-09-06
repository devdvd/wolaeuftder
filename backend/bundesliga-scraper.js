// bundesliga-scraper-fixed.js
// Korrigierte Version ohne waitForTimeout-Fehler

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

            // Moderne Syntax statt waitForTimeout
            await new Promise(resolve => setTimeout(resolve, 3000));

            const spieltagInfo = await page.evaluate(() => {
                const headings = document.querySelectorAll('h1, .heading, [class*="spieltag"]');
                
                for (let heading of headings) {
                    const text = heading.textContent || '';
                    const match = text.match(/(\d+)\.\s*Spieltag/i);
                    if (match) {
                        return {
                            spieltag: parseInt(match[1]),
                            text: text.trim()
                        };
                    }
                }

                const url = window.location.href;
                const urlMatch = url.match(/spieltag\/\d{4}-\d{4}\/(\d+)/);
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
                console.log('⚠️ Konnte aktuellen Spieltag nicht ermitteln, starte bei Spieltag 1');
                this.currentSpieltagNumber = 1;
            }

        } catch (error) {
            console.error('❌ Fehler beim Ermitteln des Spieltags:', error.message);
            this.currentSpieltagNumber = 1;
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

                    // Moderne Syntax statt waitForTimeout
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
                
                // Verschiedene Selektoren probieren
                const matchSelectors = [
                    'a[href*="/liveticker"]',
                    '.match',
                    '[data-testid*="match"]',
                    '.fixture',
                    '[class*="match"]'
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
                    return [];
                }

                matchElements.forEach((matchEl, index) => {
                    try {
                        const allText = matchEl.textContent || '';
                        
                        // Zeit extrahieren
                        let timeText = '15:30';
                        const timeMatch = allText.match(/(\d{1,2}:\d{2})/);
                        if (timeMatch) {
                            timeText = timeMatch[1];
                        }

                        // Teams extrahieren - vereinfacht
                        let homeTeam = '';
                        let awayTeam = '';
                        
                        // Suche nach "vs" Pattern
                        const vsMatch = allText.match(/([A-Za-zÄÖÜäöüß\s\d\.]+?)\s+(?:vs|gegen|-|:)\s+([A-Za-zÄÖÜäöüß\s\d\.]+)/);
                        if (vsMatch) {
                            homeTeam = vsMatch[1].trim().replace(/\s+/g, ' ');
                            awayTeam = vsMatch[2].trim().replace(/\s+/g, ' ');
                        } else {
                            // Fallback: Bekannte Teams suchen
                            const knownTeams = [
                                'Bayern München', 'Borussia Dortmund', 'RB Leipzig', 'Bayer Leverkusen',
                                'Borussia Mönchengladbach', 'VfL Wolfsburg', 'Eintracht Frankfurt', 'TSG Hoffenheim',
                                'SC Freiburg', 'Union Berlin', 'VfB Stuttgart', 'Werder Bremen',
                                'FC Augsburg', 'Mainz 05', 'FC Köln', 'FC St. Pauli', 'Hamburger SV', 'Heidenheim'
                            ];
                            
                            const foundTeams = knownTeams.filter(team => allText.includes(team));
                            if (foundTeams.length >= 2) {
                                homeTeam = foundTeams[0];
                                awayTeam = foundTeams[1];
                            }
                        }

                        // Broadcaster
                        let broadcaster = 'Unbekannt';
                        if (allText.includes('Sky')) broadcaster = 'Sky Deutschland';
                        else if (allText.includes('DAZN')) broadcaster = 'DAZN';
                        else if (allText.includes('WOW')) broadcaster = 'WOW';

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
                                url: window.location.href
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
                console.log('\n📅 Erste 3 Spiele:');
                output.matches.slice(0, 3).forEach(match => {
                    console.log(`   ${match.homeTeam} vs ${match.awayTeam} - ${match.kickoff} (${match.broadcaster})`);
                });
            }
            
        } catch (error) {
            console.error('❌ Fehler beim Speichern:', error);
        }
    }

    // Debug-Methode für offenen Browser
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

            await new Promise(resolve => setTimeout(resolve, 3000));

            const pageInfo = await page.evaluate(() => {
                return {
                    title: document.title,
                    url: window.location.href,
                    h1: document.querySelector('h1')?.textContent || 'Keine H1',
                    matchElements: document.querySelectorAll('a[href*="/liveticker"]').length,
                    allText: document.body.textContent.substring(0, 500)
                };
            });

            console.log('\n📋 Seiten-Info:');
            console.log(`Titel: ${pageInfo.title}`);
            console.log(`URL: ${pageInfo.url}`);
            console.log(`H1: ${pageInfo.h1}`);
            console.log(`Liveticker-Links: ${pageInfo.matchElements}`);
            console.log(`\n📝 Seitentext (erste 500 Zeichen):`);
            console.log(pageInfo.allText);

            console.log('\n🛠️ Browser bleibt offen - schau dir die Seite an!');
            console.log('💡 Drücke Strg+C um zu beenden');
            
            // Halte Browser offen bis Strg+C
            process.on('SIGINT', async () => {
                console.log('\n👋 Schließe Browser...');
                await browser.close();
                process.exit(0);
            });

            // Warte unendlich
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