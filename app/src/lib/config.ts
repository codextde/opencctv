import { hostnameOf } from './url';

export const DEMO = {
  baseUrl: process.env.EXPO_PUBLIC_DEMO_URL || 'https://opencctv-demo.codext.de',
  username: 'demo',
  password: 'demo',
};

export const LINKS = {
  github: 'https://github.com/codextde/opencctv',
  website: 'https://opencctv.codext.de',
  privacy: 'https://opencctv.codext.de/privacy/',
  docs: 'https://opencctv.codext.de/docs',
  company: 'https://codext.de',
};

const DEMO_HOST = hostnameOf(DEMO.baseUrl);

export function isDemoUrl(baseUrl: string) {
  return !!DEMO_HOST && hostnameOf(baseUrl) === DEMO_HOST;
}

export const SCREENSHOT_MODE = process.env.EXPO_PUBLIC_SCREENSHOTS === '1';
