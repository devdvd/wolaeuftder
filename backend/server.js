// bundesliga-scraper.js
// Backend-Script zum Scrapen der Bundesliga TV-Termine

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class BundesligaScraper {
    constructor() {
        this.baseUrl = 'https://www.bundesliga.com/de/bundesliga/spieltag';
        this.currentSeason = '2025-2026';
        this.matches = [];
        this.teams = new Set();
    }

    async scrapeAllMatchdays() {
        console.log('🚀 Starte Bundesliga TV-Termine Scraping...');
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const page = await browser.newPage();
            
            // User Agent setzen
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            let spieltag = 1;
            let hasMatches = true;

            while (hasMatches && spieltag <= 40) {
                console.log(`📅 Scrape Spieltag ${spieltag}...`);
                
                const url = `${this.baseUrl}/${this.currentSeason}/${spieltag}`;
                
                try {
                    await page.goto(url, { 
                        waitUntil: 'networkidle2',
                        timeout: 30000 
                    });

                    // Warte auf das Laden der Spiele
                    await page.waitForTimeout(2000);

                    const matches = await this.scrapeMatchday(page, spieltag);
                    
                    if (matches.length === 0) {
                        console.log(`❌ Keine Spiele für Spieltag ${spieltag} gefunden`);
                        hasMatches = false;
                        break;
                    }

                    this.matches.push(...matches);
                    
                    // Sammle Teams
                    matches.forEach(match => {
                        this.teams.add(match.homeTeam);
                        this.teams.add(match.awayTeam);
                    });

                    console.log(`✅ ${matches.length} Spiele für Spieltag ${spieltag} gesammelt`);
                    spieltag++;

                    // Pause zwischen Requests
                    await page.waitForTimeout(1000);

                } catch (error) {
                    console.error(`❌ Fehler bei Spieltag ${spieltag}:`, error.message);
                    hasMatches = false;
                }
            }

            console.log(`🎉 Scraping abgeschlossen! ${this.matches.length} Spiele von ${spieltag - 1} Spieltagen gesammelt.`);

        } finally {
            await browser.close();
        }
    }

    async scrapeMatchday(page, spieltag) {
        try {
            // Prüfe ob Spiele vorhanden sind
            const hasMatches = await page.$('.match') !== null;
            if (!hasMatches) {
                return [];
            }

            // Extrahiere Spieldaten
            const matches = await page.evaluate((spieltag, currentSeason) => {
                const matchElements = document.querySelectorAll('.match, [data-testid*="match"]');
                const matches = [];

                matchElements.forEach(matchEl => {
                    try {
                        // Datum und Zeit extrahieren
                        const dateTimeEl = matchEl.querySelector('.match-date, .date-time, [class*="date"]');
                        const timeEl = matchEl.querySelector('.match-time, .time, [class*="time"]');
                        
                        // Teams extrahieren
                        const teamElements = matchEl.querySelectorAll('.team-name, [class*="team"]');
                        if (teamElements.length < 2) return;

                        const homeTeam = teamElements[0]?.textContent?.trim();
                        const awayTeam = teamElements[1]?.textContent?.trim();

                        if (!homeTeam || !awayTeam) return;

                        // Broadcaster extrahieren
                        const broadcasterEl = matchEl.querySelector('img[alt*="Sky"], img[alt*="DAZN"], img[alt*="WOW"]');
                        const broadcaster = broadcasterEl?.alt || 'Unbekannt';

                        // Datum/Zeit parsen
                        const dateText = dateTimeEl?.textContent?.trim() || '';
                        const timeText = timeEl?.textContent?.trim() || '';
                        
                        // Vereinfachte Datum/Zeit-Erstellung
                        const now = new Date();
                        const matchDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + spieltag * 7);
                        
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
                            kickoff: timeText || '15:30',
                            broadcaster: broadcaster,
                            season: currentSeason,
                            url: window.location.href
                        });

                    } catch (error) {
                        console.log('Fehler beim Parsen eines Spiels:', error);
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
            totalMatches: this.matches.length,
            teams: Array.from(this.teams).sort(),
            matches: this.matches.sort((a, b) => new Date(a.date) - new Date(b.date))
        };

        try {
            await fs.writeFile(filename, JSON.stringify(output, null, 2), 'utf8');
            console.log(`💾 Daten gespeichert in ${filename}`);
            console.log(`📊 ${output.totalMatches} Spiele, ${output.teams.length} Teams`);
        } catch (error) {
            console.error('❌ Fehler beim Speichern:', error);
        }
    }

    // Alternative: Einfacherer Scraper ohne Browser-Automation
    async scrapeWithCheerio() {
        const axios = require('axios');
        const cheerio = require('cheerio');

        console.log('🕸️ Verwende Cheerio für einfaches Scraping...');

        for (let spieltag = 1; spieltag <= 10; spieltag++) {
            try {
                const url = `${this.baseUrl}/${this.currentSeason}/${spieltag}`;
                console.log(`📡 Lade ${url}`);

                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 10000
                });

                const $ = cheerio.load(response.data);
                
                // Diese Selektoren müssen angepasst werden basierend auf der tatsächlichen HTML-Struktur
                const matches = [];
                
                $('.match-item, .fixture').each((i, el) => {
                    const homeTeam = $(el).find('.home-team, .team-home').text().trim();
                    const awayTeam = $(el).find('.away-team, .team-away').text().trim();
                    const datetime = $(el).find('.datetime, .match-time').text().trim();
                    const broadcaster = $(el).find('.broadcaster img').attr('alt') || 'Unbekannt';

                    if (homeTeam && awayTeam) {
                        matches.push({
                            spieltag,
                            homeTeam,
                            awayTeam,
                            datetime,
                            broadcaster,
                            season: this.currentSeason
                        });
                    }
                });

                if (matches.length === 0) break;

                this.matches.push(...matches);
                console.log(`✅ ${matches.length} Spiele für Spieltag ${spieltag}`);

                // Pause zwischen Requests
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                console.error(`❌ Fehler bei Spieltag ${spieltag}:`, error.message);
                break;
            }
        }
    }
}

// GitHub Actions Integration
async function runForGitHubActions() {
    const scraper = new BundesligaScraper();
    
    try {
        await scraper.scrapeAllMatchdays();
        await scraper.saveToJSON();
        
        // Erfolg für GitHub Actions
        process.exit(0);
    } catch (error) {
        console.error('❌ Scraping fehlgeschlagen:', error);
        process.exit(1);
    }
}

// CLI Usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const useCheerio = args.includes('--cheerio');
    
    async function main() {
        const scraper = new BundesligaScraper();
        
        try {
            if (useCheerio) {
                await scraper.scrapeWithCheerio();
            } else {
                await scraper.scrapeAllMatchdays();
            }
            
            await scraper.saveToJSON();
            
        } catch (error) {
            console.error('❌ Fehler:', error);
        }
    }
    
    main();
}

module.exports = { BundesligaScraper, runForGitHubActions };

// Package.json für Backend
/*
{
  "name": "bundesliga-scraper",
  "version": "1.0.0",
  "description": "Scraper für Bundesliga TV-Termine",
  "main": "bundesliga-scraper.js",
  "scripts": {
    "start": "node bundesliga-scraper.js",
    "scrape": "node bundesliga-scraper.js",
    "scrape-cheerio": "node bundesliga-scraper.js --cheerio",
    "test": "echo \"No tests yet\""
  },
  "dependencies": {
    "puppeteer": "^21.0.0",
    "axios": "^1.5.0",
    "cheerio": "^1.0.0-rc.12"
  },
  "keywords": ["bundesliga", "scraping", "tv", "termine"],
  "author": "Dein Name",
  "license": "MIT"
}
*/