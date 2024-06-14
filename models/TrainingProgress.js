import m from 'mongoose';


const examAttemptSchema = new m.Schema({
  examId: { type: m.Schema.Types.ObjectId, ref: 'Exam' },
  attempts: { type: Number, default: 0 },
  lastAttemptTime: Date,
  highestScore: { type: Number, default: 0 },
  nextEligibleRetestDate: Date, // For managing retest waiting period
  passed: Boolean,
});

const courseProgressSchema = new m.Schema({
  courseName: { type: String }, // Use this to match with _id of the course within a module
  isCompleted: { type: Boolean, default: false }, // Tracks completion status of each course
  completionDate: { type: Date },
  exams: [examAttemptSchema],
});

const trainingTeamSchema = new m.Schema({
  trainers: [{ type: m.Schema.Types.ObjectId, ref: 'User' }], // Reference to User model for trainers
  assignedDate: Date,
  // Additional fields as necessary, e.g., notes, feedback, etc.
});

const moduleProgressSchema = new m.Schema({
  moduleId: { type: m.Schema.Types.ObjectId, ref: 'TrainingModule' },
  status: { type: Number },
  courses: [courseProgressSchema],
  completionDate: { type: Date },
  trainingTeam: trainingTeamSchema
})

const trainingProgressSchema = new m.Schema({
  cid: { type: Number },
  modulesInProgress: [moduleProgressSchema],
  completedModules: [moduleProgressSchema],
},{
  collection: 'trainingProgress'
});
  
export default m.model('TrainingProgress', trainingProgressSchema, 'trainingProgress');