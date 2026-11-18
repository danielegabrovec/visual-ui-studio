import os from 'node:os';
import type { HardwareAdvisorReport, UnslothModelRecommendation } from '@shared/ipc-contract';

export const VRAM_HEADROOM_RESERVED_MB = 768;

export const UNSLOTH_MODEL_CATALOG: UnslothModelRecommendation[] = [
  {
    id: 'unsloth-qwen25-coder-7b',
    repoId: 'unsloth/Qwen2.5-Coder-7B-Instruct-GGUF',
    ollamaPullUri: 'hf.co/unsloth/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M',
    displayName: 'Qwen 2.5 Coder 7B (Unsloth Dynamic Q4_K_M)',
    quantization: 'UD-Q4_K_M',
    estimatedVramGb: 5.2,
    role: 'coding',
    tier: 'entry',
    description:
      'Fast, low-VRAM UI & code generation model with Unsloth Dynamic 2.0 quantization preserving JSON schema accuracy.',
  },
  {
    id: 'unsloth-qwen25-vl-3b',
    repoId: 'unsloth/Qwen2.5-VL-3B-Instruct-GGUF',
    ollamaPullUri: 'hf.co/unsloth/Qwen2.5-VL-3B-Instruct-GGUF:Q4_K_M',
    displayName: 'Qwen 2.5 VL 3B Vision (Unsloth Q4_K_M)',
    quantization: 'Q4_K_M',
    estimatedVramGb: 3.4,
    role: 'vision',
    tier: 'entry',
    description:
      'Lightweight multimodal Vision-to-UI model for converting wireframes and screenshots on 6–8 GB VRAM systems.',
  },
  {
    id: 'unsloth-qwen25-coder-14b',
    repoId: 'unsloth/Qwen2.5-Coder-14B-Instruct-128K-GGUF',
    ollamaPullUri: 'hf.co/unsloth/Qwen2.5-Coder-14B-Instruct-128K-GGUF:Q4_K_M',
    displayName: 'Qwen 2.5 Coder 14B 128K (Unsloth Dynamic)',
    quantization: 'UD-Q4_K_XL',
    estimatedVramGb: 9.6,
    role: 'coding',
    tier: 'mid',
    description:
      'Sweet-spot 14B agentic UI architect for React, HTMX, .NET MAUI, Svelte & Tauri with 128K context support.',
  },
  {
    id: 'unsloth-gemma3-12b-vision',
    repoId: 'unsloth/gemma-3-12b-it-GGUF',
    ollamaPullUri: 'hf.co/unsloth/gemma-3-12b-it-GGUF:Q4_K_M',
    displayName: 'Gemma 3 12B Multimodal (Unsloth Dynamic)',
    quantization: 'UD-Q4_K_XL',
    estimatedVramGb: 8.8,
    role: 'vision',
    tier: 'mid',
    description:
      'Unified multimodal Vision + UI layout synthesis model ideal for Screenshot-to-Canvas reconstruction.',
  },
  {
    id: 'unsloth-deepseek-r1-14b',
    repoId: 'unsloth/DeepSeek-R1-Distill-Qwen-14B-GGUF',
    ollamaPullUri: 'hf.co/unsloth/DeepSeek-R1-Distill-Qwen-14B-GGUF:Q4_K_M',
    displayName: 'DeepSeek R1 Distill Qwen 14B (Unsloth)',
    quantization: 'UD-Q4_K_M',
    estimatedVramGb: 9.5,
    role: 'reasoning',
    tier: 'mid',
    description:
      'Chain-of-thought (<think>) reasoning model for complex multi-component refactoring and accessibility audits.',
  },
  {
    id: 'unsloth-qwen25-coder-32b',
    repoId: 'unsloth/Qwen2.5-Coder-32B-Instruct-GGUF',
    ollamaPullUri: 'hf.co/unsloth/Qwen2.5-Coder-32B-Instruct-GGUF:Q4_K_M',
    displayName: 'Qwen 2.5 Coder 32B (Unsloth Dynamic)',
    quantization: 'UD-Q4_K_XL',
    estimatedVramGb: 19.8,
    role: 'coding',
    tier: 'high',
    description:
      'Flagship local coding intelligence for 24 GB+ VRAM GPUs and 32 GB+ Unified Memory workstations.',
  },
  {
    id: 'unsloth-qwen25-vl-7b',
    repoId: 'unsloth/Qwen2.5-VL-7B-Instruct-GGUF',
    ollamaPullUri: 'hf.co/unsloth/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M',
    displayName: 'Qwen 2.5 VL 7B Vision (Unsloth Dynamic)',
    quantization: 'UD-Q4_K_XL',
    estimatedVramGb: 6.4,
    role: 'vision',
    tier: 'high',
    description:
      'High-precision bounding-box & layout hierarchy extractor for faithful Wireframe/Screenshot-to-UI.',
  },
];

export function computeHardwareAdvisorReport(overrides?: {
  totalRamMb?: number;
  freeRamMb?: number;
  cpuCores?: number;
  platform?: string;
  arch?: string;
}): HardwareAdvisorReport {
  const totalSystemRamMb = overrides?.totalRamMb ?? Math.round(os.totalmem() / (1024 * 1024));
  const freeSystemRamMb = overrides?.freeRamMb ?? Math.round(os.freemem() / (1024 * 1024));
  const cpuCores = overrides?.cpuCores ?? Math.max(1, os.cpus().length);
  const platform = overrides?.platform ?? os.platform();
  const arch = overrides?.arch ?? os.arch();

  let recommendedTier: HardwareAdvisorReport['recommendedTier'];
  let recommendedCodingModel: string;
  let recommendedVisionModel: string;
  let adviceSummary: string;

  if (totalSystemRamMb < 14_000) {
    recommendedTier = 'entry';
    recommendedCodingModel = 'hf.co/unsloth/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M';
    recommendedVisionModel = 'hf.co/unsloth/Qwen2.5-VL-3B-Instruct-GGUF:Q4_K_M';
    adviceSummary = `Entry hardware profile (${Math.round(totalSystemRamMb / 1024)} GB RAM, ${cpuCores} cores). Use 3B–7B Unsloth Q4_K_M models with 8K context; ${VRAM_HEADROOM_RESERVED_MB} MB VRAM reserved for 60fps Canvas.`;
  } else if (totalSystemRamMb < 28_000) {
    recommendedTier = 'mid';
    recommendedCodingModel = 'hf.co/unsloth/Qwen2.5-Coder-14B-Instruct-128K-GGUF:Q4_K_M';
    recommendedVisionModel = 'hf.co/unsloth/gemma-3-12b-it-GGUF:Q4_K_M';
    adviceSummary = `Mid-range workstation (${Math.round(totalSystemRamMb / 1024)} GB RAM, ${cpuCores} cores). Ideal for 7B–14B Unsloth Dynamic 2.0 GGUF models at 16K–24K context with ${VRAM_HEADROOM_RESERVED_MB} MB Canvas GPU reserve.`;
  } else {
    recommendedTier = 'high';
    recommendedCodingModel = 'hf.co/unsloth/Qwen2.5-Coder-32B-Instruct-GGUF:Q4_K_M';
    recommendedVisionModel = 'hf.co/unsloth/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M';
    adviceSummary = `High-capacity workstation (${Math.round(totalSystemRamMb / 1024)} GB RAM, ${cpuCores} cores). Ready for 14B–32B Unsloth coding & vision models up to 32K+ context (${VRAM_HEADROOM_RESERVED_MB} MB Canvas GPU reserve).`;
  }

  return {
    totalSystemRamMb,
    freeSystemRamMb,
    cpuCores,
    platform,
    arch,
    recommendedTier,
    vramHeadroomReservedMb: VRAM_HEADROOM_RESERVED_MB,
    recommendedCodingModel,
    recommendedVisionModel,
    adviceSummary,
  };
}

export function recommendedNumCtxForTier(tier: HardwareAdvisorReport['recommendedTier']): number {
  switch (tier) {
    case 'entry':
      return 8192;
    case 'mid':
      return 16384;
    case 'high':
      return 32768;
  }
}
