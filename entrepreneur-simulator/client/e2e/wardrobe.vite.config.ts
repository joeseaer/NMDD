import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';
export default mergeConfig(base, defineConfig({server:{proxy:{'/api':{target:'http://127.0.0.1:3101',changeOrigin:true}}}}));
