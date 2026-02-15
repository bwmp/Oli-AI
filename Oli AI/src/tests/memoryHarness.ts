import assert from 'assert';
import {
	ConversationEntry,
	formatAssistantHistoryBlock,
	formatUserHistoryBlock,
	mergeRollingSummary,
	detectTopicShift,
} from '~/services/ollama';
import { inferMemoryCardUpdate } from '~/services/profiles';

function testMultiUserIdentityMemory(): void {
	const userA = { id: '111', name: 'UserA' };
	const userB = { id: '222', name: 'UserB' };

	const aMemory = inferMemoryCardUpdate('i like pineapple pizza and i prefer crunchy crust');
	const bMemory = inferMemoryCardUpdate('i like sushi but i hate olives');

	assert.ok((aMemory.likes || []).some(item => item.includes('pineapple pizza')));
	assert.ok((bMemory.likes || []).some(item => item.includes('sushi')));

	const historyBlocks = [
		formatUserHistoryBlock('chan-1', 'general', userA.name, userA.id, 'i like pineapple pizza'),
		formatAssistantHistoryBlock('chan-1', 'general', 'noted!'),
		formatUserHistoryBlock('chan-1', 'general', userB.name, userB.id, 'i like sushi'),
	];

	assert.ok(historyBlocks[0].includes('[User: UserA | id=111]'));
	assert.ok(historyBlocks[2].includes('[User: UserB | id=222]'));
	assert.ok(historyBlocks[1].includes('[Assistant]'));

	const summaryMessages: ConversationEntry[] = [
		{ role: 'user', username: userA.name, userId: userA.id, content: 'i like pineapple pizza', timestamp: Date.now() },
		{ role: 'assistant', content: 'good choice', timestamp: Date.now() },
		{ role: 'user', username: userB.name, userId: userB.id, content: 'i like sushi', timestamp: Date.now() },
	];

	const summary = mergeRollingSummary('', summaryMessages, 16);
	assert.ok(summary.includes('UserA (id=111) likes pineapple pizza'));
	assert.ok(summary.includes('UserB (id=222) likes sushi'));
	assert.ok(!summary.includes('UserA (id=222)'));
}

function testLongConversationSummaryRetention(): void {
	const messages: ConversationEntry[] = [
		{ role: 'user', username: 'UserA', userId: '111', content: 'i like jazz music', timestamp: Date.now() },
	];

	for (let i = 0; i < 10; i++) {
		messages.push({
			role: i % 2 === 0 ? 'assistant' : 'user',
			username: i % 2 === 0 ? undefined : 'UserB',
			userId: i % 2 === 0 ? undefined : '222',
			content: `conversation filler message ${i}`,
			timestamp: Date.now(),
		});
	}

	const summary = mergeRollingSummary('', messages, 26);
	assert.ok(summary.includes('UserA (id=111) likes jazz music'));
	assert.ok(summary.split('\n').length <= 26);

	const shifted = detectTopicShift('let us discuss gardening and compost', [
		'we were debugging typescript errors all night',
		'the build pipeline is still flaky',
	]);
	assert.ok(shifted);
}

function main(): void {
	testMultiUserIdentityMemory();
	testLongConversationSummaryRetention();
	process.stdout.write('memory harness: all checks passed\n');
	process.exit(0);
}

main();
