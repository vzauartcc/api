import { submitExam } from '../controllers/exam/attempt.js';
import { ExamAttemptModel } from '../models/examAttempt.js';

export async function expireExamAttempts() {
	const today = new Date();
	const cutoff = new Date();
	cutoff.setDate(today.getDate() - 31);
	const attempts = await ExamAttemptModel.find({
		status: { $nin: ['completed', 'timed_out'] },
		deleted: { $ne: true },
		createdAt: { $lte: cutoff },
	})
		.populate('exam')
		.populate('user')
		.exec();

	attempts.forEach(async (attempt) => {
		console.log(`Expiring exam attempt ${attempt.id}`);
		await submitExam(attempt, true);
	});
}
