interface FalImage {
	url: string;
}

interface FalResponse {
	images?: FalImage[];
	data?: {
		images?: FalImage[];
	};
	output?: {
		images?: FalImage[];
	};
}

function extractUrls(value: unknown): string[] {
	const out: string[] = [];

	function walk(node: unknown) {
		if (!node) return;
		if (typeof node === 'string') {
			if (node.startsWith('http://') || node.startsWith('https://')) {
				out.push(node);
			}
			return;
		}
		if (Array.isArray(node)) {
			for (const item of node) walk(item);
			return;
		}
		if (typeof node === 'object') {
			for (const v of Object.values(node as Record<string, unknown>)) walk(v);
		}
	}

	walk(value);
	return [...new Set(out)];
}

export async function generateImages(prompt: string, count = 1): Promise<string[]> {
	const apiKey = process.env.FAL_API_KEY;
	if (!apiKey) {
		throw new Error('FAL_API_KEY is not set');
	}

	const model = process.env.FAL_MODEL || 'fal-ai/flux/schnell';
	const imageSize = process.env.FAL_IMAGE_SIZE || 'square_hd';
	const timeout = parseInt(process.env.FAL_TIMEOUT || '120000', 10);
	const safeCount = Math.max(1, Math.min(count, 4));

	const payload: Record<string, unknown> = {
		prompt,
		image_size: imageSize,
		num_images: safeCount,
	};

	if (model.includes('flux/schnell')) {
		payload.num_inference_steps = 4;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const response = await fetch(`https://fal.run/${model}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Key ${apiKey}`,
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`fal.ai error (${response.status}): ${errorText}`);
		}

		const data = await response.json() as FalResponse;
		const urls = extractUrls(data);
		if (urls.length === 0) {
			throw new Error('fal.ai returned no image URLs');
		}

		return urls.slice(0, safeCount);
	} catch (error: any) {
		if (error?.name === 'AbortError') {
			throw new Error('fal.ai request timed out');
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}
