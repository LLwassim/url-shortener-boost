import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from './logger.service';
import axios, { AxiosInstance } from 'axios';

interface VirusTotalResponse {
  data: {
    attributes: {
      stats: {
        malicious: number;
        suspicious: number;
        undetected: number;
        harmless: number;
        timeout: number;
      };
    };
  };
}

@Injectable()
export class VirusTotalService {
  private readonly httpClient: AxiosInstance;
  private readonly apiKey: string;
  private readonly isEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.apiKey = this.configService.get<string>('VIRUS_TOTAL_API_KEY');
    this.isEnabled = this.configService.get<boolean>('ENABLE_URL_SCANNING', false) && !!this.apiKey;

    if (this.isEnabled) {
      this.httpClient = axios.create({
        baseURL: 'https://www.virustotal.com/api/v3',
        timeout: 10000,
        headers: {
          'x-apikey': this.apiKey,
          'User-Agent': 'URL-Shortener-Boost/1.0',
        },
      });

      // Request interceptor for logging
      this.httpClient.interceptors.request.use(
        (config) => {
          this.logger.debug('VirusTotal API request', 'VirusTotalService', {
            method: config.method,
            url: config.url,
          });
          return config;
        },
        (error) => {
          this.logger.error('VirusTotal API request error', error.message, 'VirusTotalService');
          return Promise.reject(error);
        }
      );

      // Response interceptor for logging
      this.httpClient.interceptors.response.use(
        (response) => {
          this.logger.debug('VirusTotal API response', 'VirusTotalService', {
            status: response.status,
            url: response.config.url,
          });
          return response;
        },
        (error) => {
          this.logger.error('VirusTotal API response error', error.message, 'VirusTotalService', {
            status: error.response?.status,
            url: error.config?.url,
          });
          return Promise.reject(error);
        }
      );
    }
  }

  /**
   * Check if URL is safe using VirusTotal
   */
  async checkUrl(url: string): Promise<boolean> {
    if (!this.isEnabled) {
      this.logger.debug('VirusTotal scanning disabled, allowing URL', 'VirusTotalService', { url });
      return true;
    }

    try {
      // First, submit the URL for analysis
      const urlId = await this.submitUrl(url);
      
      // Wait a moment for analysis to complete
      await this.sleep(2000);
      
      // Get the analysis result
      const result = await this.getUrlAnalysis(urlId);
      
      return this.evaluateResult(result, url);
    } catch (error) {
      this.logger.error('VirusTotal URL check failed', error.message, 'VirusTotalService', {
        url,
        error: error.stack,
      });
      
      // On error, allow the URL to avoid blocking legitimate requests
      return true;
    }
  }

  /**
   * Submit URL to VirusTotal for analysis
   */
  private async submitUrl(url: string): Promise<string> {
    try {
      const formData = new URLSearchParams();
      formData.append('url', url);

      const response = await this.httpClient.post('/urls', formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const urlId = response.data.data.id;
      
      this.logger.debug('URL submitted to VirusTotal', 'VirusTotalService', {
        url,
        urlId,
      });

      return urlId;
    } catch (error) {
      if (error.response?.status === 429) {
        throw new Error('VirusTotal API rate limit exceeded');
      }
      throw error;
    }
  }

  /**
   * Get URL analysis result
   */
  private async getUrlAnalysis(urlId: string): Promise<VirusTotalResponse> {
    try {
      const response = await this.httpClient.get(`/analyses/${urlId}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Analysis not found');
      }
      throw error;
    }
  }

  /**
   * Evaluate VirusTotal result
   */
  private evaluateResult(result: VirusTotalResponse, url: string): boolean {
    const stats = result.data.attributes.stats;
    
    const malicious = stats.malicious || 0;
    const suspicious = stats.suspicious || 0;
    const harmless = stats.harmless || 0;
    const undetected = stats.undetected || 0;
    
    const totalScans = malicious + suspicious + harmless + undetected;
    const unsafeCount = malicious + suspicious;
    
    // Consider URL unsafe if more than 2 engines detect it as malicious/suspicious
    // or if the malicious percentage is > 10%
    const isUnsafe = unsafeCount > 2 || (totalScans > 0 && (unsafeCount / totalScans) > 0.1);
    
    this.logger.debug('VirusTotal analysis result', 'VirusTotalService', {
      url,
      malicious,
      suspicious,
      harmless,
      undetected,
      totalScans,
      unsafeCount,
      isUnsafe,
    });

    if (isUnsafe) {
      this.logger.logSecurity('malicious_url_detected', {
        url,
        malicious,
        suspicious,
        totalScans,
        service: 'virustotal',
      }, 'high');
    }

    return !isUnsafe;
  }

  /**
   * Get URL reputation (without submitting for analysis)
   */
  async getUrlReputation(url: string): Promise<{ isSafe: boolean; stats?: any }> {
    if (!this.isEnabled) {
      return { isSafe: true };
    }

    try {
      // Encode URL for VirusTotal API
      const urlId = Buffer.from(url).toString('base64').replace(/=/g, '');
      
      const response = await this.httpClient.get(`/urls/${urlId}`);
      const result = response.data as VirusTotalResponse;
      
      const isSafe = this.evaluateResult(result, url);
      
      return {
        isSafe,
        stats: result.data.attributes.stats,
      };
    } catch (error) {
      if (error.response?.status === 404) {
        // URL not in VirusTotal database, submit for analysis
        return { isSafe: await this.checkUrl(url) };
      }
      
      this.logger.error('Failed to get URL reputation', error.message, 'VirusTotalService', {
        url,
        error: error.stack,
      });
      
      // On error, assume safe to avoid blocking
      return { isSafe: true };
    }
  }

  /**
   * Check if the service is enabled and configured
   */
  isServiceEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Get service health status
   */
  async getHealth(): Promise<{ healthy: boolean; apiKey: boolean; rateLimitOk: boolean }> {
    if (!this.isEnabled) {
      return {
        healthy: false,
        apiKey: false,
        rateLimitOk: true,
      };
    }

    try {
      // Make a simple API call to check connectivity
      await this.httpClient.get('/versions');
      
      return {
        healthy: true,
        apiKey: true,
        rateLimitOk: true,
      };
    } catch (error) {
      const rateLimitOk = error.response?.status !== 429;
      
      return {
        healthy: false,
        apiKey: error.response?.status !== 403,
        rateLimitOk,
      };
    }
  }

  /**
   * Sleep utility function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Batch check multiple URLs
   */
  async batchCheckUrls(urls: string[]): Promise<Array<{ url: string; isSafe: boolean }>> {
    if (!this.isEnabled) {
      return urls.map(url => ({ url, isSafe: true }));
    }

    const results = await Promise.allSettled(
      urls.map(async (url) => {
        const isSafe = await this.checkUrl(url);
        return { url, isSafe };
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        this.logger.error('Batch URL check failed', result.reason.message, 'VirusTotalService', {
          url: urls[index],
        });
        return { url: urls[index], isSafe: true }; // Default to safe on error
      }
    });
  }
}