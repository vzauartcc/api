import m from 'mongoose';


const courseProgressSchema = new m.Schema({
  courseName: { type: String }, // Use this to match with _id of the course within a module
  isCompleted: { type: Boolean, default: false }, // Tracks completion status of each course
  completionDate: { type: Date }
});

const trainingProgressSchema = new m.Schema({
  cid: { type: Number },
  modulesInProgress: [{
    moduleId: { type: m.Schema.Types.ObjectId, ref: 'TrainingModule' },
    status: { type: Number, default: 0 }, // 0: Not Started, 1: In Progress, 2: Completed
    courses: [courseProgressSchema], // Array of course progress objects
  }],
  completedModules: [{
    moduleId: { type: m.Schema.Types.ObjectId, ref: 'TrainingModule' },
    completionDate: { type: Date }, // Tracks when the module was completed
  }]
},{
  collection: 'trainingProgress'
});
  
export default m.model('TrainingProgress', trainingProgressSchema, 'trainingProgress');