import { Injectable } from '@nestjs/common';

export interface DeviceInfo {
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  browser: string;
  browserVersion?: string;
  os: string;
  osVersion?: string;
}

@Injectable()
export class UserAgentParser {
  /**
   * Parse user agent string to extract device information
   */
  parse(userAgent: string): DeviceInfo {
    if (!userAgent) {
      return {
        deviceType: 'unknown',
        browser: 'unknown',
        os: 'unknown',
      };
    }

    const ua = userAgent.toLowerCase();

    return {
      deviceType: this.getDeviceType(ua),
      browser: this.getBrowser(ua),
      browserVersion: this.getBrowserVersion(ua),
      os: this.getOperatingSystem(ua),
      osVersion: this.getOSVersion(ua),
    };
  }

  /**
   * Determine device type from user agent
   */
  private getDeviceType(ua: string): 'desktop' | 'mobile' | 'tablet' | 'unknown' {
    // Check for tablet first (more specific)
    if (
      ua.includes('ipad') ||
      (ua.includes('android') && !ua.includes('mobile')) ||
      ua.includes('tablet') ||
      (ua.includes('windows') && ua.includes('touch'))
    ) {
      return 'tablet';
    }

    // Check for mobile
    if (
      ua.includes('mobile') ||
      ua.includes('iphone') ||
      ua.includes('ipod') ||
      ua.includes('android') ||
      ua.includes('blackberry') ||
      ua.includes('windows phone') ||
      ua.includes('opera mini') ||
      ua.includes('iemobile')
    ) {
      return 'mobile';
    }

    // Check for desktop indicators
    if (
      ua.includes('windows') ||
      ua.includes('macintosh') ||
      ua.includes('linux') ||
      ua.includes('x11')
    ) {
      return 'desktop';
    }

    return 'unknown';
  }

  /**
   * Extract browser name from user agent
   */
  private getBrowser(ua: string): string {
    // Order matters - check more specific browsers first
    if (ua.includes('edg/') || ua.includes('edge/')) {
      return 'Edge';
    }
    
    if (ua.includes('opr/') || ua.includes('opera')) {
      return 'Opera';
    }
    
    if (ua.includes('chrome/') && !ua.includes('chromium/')) {
      return 'Chrome';
    }
    
    if (ua.includes('chromium/')) {
      return 'Chromium';
    }
    
    if (ua.includes('firefox/')) {
      return 'Firefox';
    }
    
    if (ua.includes('safari/') && !ua.includes('chrome/')) {
      return 'Safari';
    }
    
    if (ua.includes('msie') || ua.includes('trident/')) {
      return 'Internet Explorer';
    }
    
    if (ua.includes('samsung')) {
      return 'Samsung Browser';
    }
    
    if (ua.includes('ucbrowser')) {
      return 'UC Browser';
    }

    return 'Unknown';
  }

  /**
   * Extract browser version
   */
  private getBrowserVersion(ua: string): string | undefined {
    let match: RegExpMatchArray | null = null;

    if (ua.includes('edg/')) {
      match = ua.match(/edg\/([0-9.]+)/);
    } else if (ua.includes('edge/')) {
      match = ua.match(/edge\/([0-9.]+)/);
    } else if (ua.includes('opr/')) {
      match = ua.match(/opr\/([0-9.]+)/);
    } else if (ua.includes('chrome/')) {
      match = ua.match(/chrome\/([0-9.]+)/);
    } else if (ua.includes('firefox/')) {
      match = ua.match(/firefox\/([0-9.]+)/);
    } else if (ua.includes('safari/') && ua.includes('version/')) {
      match = ua.match(/version\/([0-9.]+)/);
    } else if (ua.includes('msie')) {
      match = ua.match(/msie ([0-9.]+)/);
    } else if (ua.includes('trident/')) {
      match = ua.match(/rv:([0-9.]+)/);
    }

    return match ? match[1] : undefined;
  }

  /**
   * Extract operating system from user agent
   */
  private getOperatingSystem(ua: string): string {
    if (ua.includes('windows nt 10.0')) {
      return 'Windows 10';
    }
    
    if (ua.includes('windows nt 6.3')) {
      return 'Windows 8.1';
    }
    
    if (ua.includes('windows nt 6.2')) {
      return 'Windows 8';
    }
    
    if (ua.includes('windows nt 6.1')) {
      return 'Windows 7';
    }
    
    if (ua.includes('windows nt')) {
      return 'Windows';
    }
    
    if (ua.includes('macintosh') || ua.includes('mac os x')) {
      return 'macOS';
    }
    
    if (ua.includes('iphone os') || ua.includes('iphone')) {
      return 'iOS';
    }
    
    if (ua.includes('ipad')) {
      return 'iPadOS';
    }
    
    if (ua.includes('android')) {
      return 'Android';
    }
    
    if (ua.includes('linux')) {
      return 'Linux';
    }
    
    if (ua.includes('ubuntu')) {
      return 'Ubuntu';
    }
    
    if (ua.includes('debian')) {
      return 'Debian';
    }
    
    if (ua.includes('fedora')) {
      return 'Fedora';
    }
    
    if (ua.includes('centos')) {
      return 'CentOS';
    }

    return 'Unknown';
  }

  /**
   * Extract OS version
   */
  private getOSVersion(ua: string): string | undefined {
    let match: RegExpMatchArray | null = null;

    if (ua.includes('windows nt')) {
      match = ua.match(/windows nt ([0-9.]+)/);
    } else if (ua.includes('mac os x')) {
      match = ua.match(/mac os x ([0-9_.]+)/);
      if (match) {
        return match[1].replace(/_/g, '.');
      }
    } else if (ua.includes('iphone os')) {
      match = ua.match(/iphone os ([0-9_.]+)/);
      if (match) {
        return match[1].replace(/_/g, '.');
      }
    } else if (ua.includes('android')) {
      match = ua.match(/android ([0-9.]+)/);
    }

    return match ? match[1] : undefined;
  }

  /**
   * Check if the user agent indicates a bot/crawler
   */
  isBot(userAgent: string): boolean {
    if (!userAgent) {
      return false;
    }

    const ua = userAgent.toLowerCase();
    const botPatterns = [
      'googlebot',
      'bingbot',
      'slurp',
      'duckduckbot',
      'baiduspider',
      'yandexbot',
      'facebookexternalhit',
      'twitterbot',
      'linkedinbot',
      'whatsapp',
      'telegram',
      'crawler',
      'spider',
      'bot',
      'scraper',
      'curl',
      'wget',
      'python-requests',
      'node-fetch',
      'axios',
    ];

    return botPatterns.some(pattern => ua.includes(pattern));
  }

  /**
   * Get simplified device category for analytics
   */
  getDeviceCategory(userAgent: string): 'mobile' | 'desktop' | 'bot' | 'unknown' {
    if (this.isBot(userAgent)) {
      return 'bot';
    }

    const deviceInfo = this.parse(userAgent);
    
    if (deviceInfo.deviceType === 'mobile' || deviceInfo.deviceType === 'tablet') {
      return 'mobile';
    }
    
    if (deviceInfo.deviceType === 'desktop') {
      return 'desktop';
    }

    return 'unknown';
  }

  /**
   * Extract key device metrics for analytics
   */
  getAnalyticsData(userAgent: string): {
    deviceType: string;
    browser: string;
    os: string;
    isBot: boolean;
  } {
    const deviceInfo = this.parse(userAgent);
    
    return {
      deviceType: deviceInfo.deviceType,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
      isBot: this.isBot(userAgent),
    };
  }
}