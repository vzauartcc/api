import m from 'mongoose';

const trainingModuleSchema = new m.Schema({
    name: String,
    description: String,
    track: String, // "home" or "visiting"
    courses: [{
      courseName: { type: String },
      description: { type: String },
      type: { type: String },
      facility: { type: String }
    }],
    isExtension: { type: Boolean, default: false },
    prerequisites: [{ type: m.Schema.Types.ObjectId, ref: 'TrainingModule' }], // References to prerequisite modules
    extensionModule: { type: m.Schema.Types.ObjectId, ref: 'TrainingModule', default: null }, // Link to a module if this is an extension
},{
  collection: 'trainingModule'
});
  
export default m.model('TrainingModule', trainingModuleSchema, 'trainingModule');