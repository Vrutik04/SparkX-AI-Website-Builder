import {Request, Response} from 'express'
import prisma from '../lib/prisma.js';
import openai, { AI_MODEL } from '../configs/openai.js';
import {
    HTML_REVISION_SYSTEM_PROMPT,
    ENHANCE_REVISION_SYSTEM_PROMPT,
    buildRevisionUserPrompt
} from '../lib/prompts.js';

// Controller Function to Make Revision
export const makeRevision = async (req: Request, res: Response) => {
    const userId = req.userId;

    try {
        
        const {projectId} = req.params;
        const {message} = req.body;

        const user = await prisma.user.findUnique({
            where: {id: userId}
        })

        if(!userId || !user){
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if(user.credits < 5){
            return res.status(403).json({ message: 'add more credits to make changes' });
        }

        if(!message || message.trim() === ''){
            return res.status(400).json({ message: 'Please enter a valid prompt' });
        }

        const currentProject = await prisma.websiteProject.findUnique({
            where: {id: projectId, userId},
            include: {versions: true}
        })

        if(!currentProject){
            return res.status(404).json({ message: 'Project not found' });
        }

        await prisma.conversation.create({
            data: {
                role: 'user',
                content: message,
                projectId
            }
        })

        await prisma.user.update({
            where: {id: userId},
            data: {credits: {decrement: 5}}
        })

        // STEP 1: Enhance the user's edit request (fast call — max 200 tokens)
        const promptEnhanceResponse = await openai.chat.completions.create({
            model: AI_MODEL,
            temperature: 0.4,
            max_tokens: 200,
            messages: [
                { role: 'system', content: ENHANCE_REVISION_SYSTEM_PROMPT },
                { role: 'user', content: `User's edit request: "${message}"` }
            ]
        })

        const enhancedRequest = promptEnhanceResponse.choices[0].message.content || message;

        // Show the enhancement in chat
        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `✨ Understood: "${enhancedRequest}"`,
                projectId
            }
        })

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'Applying your changes now...',
                projectId
            }
        })

        // STEP 2: Generate updated website with the enhanced request
        const codeGenerationResponse = await openai.chat.completions.create({
            model: AI_MODEL,
            temperature: 0.3,
            max_tokens: 8000,
            messages: [
                { role: 'system', content: HTML_REVISION_SYSTEM_PROMPT },
                { role: 'user', content: buildRevisionUserPrompt(currentProject.current_code || '', enhancedRequest) }
            ]
        })

        const rawCode = codeGenerationResponse.choices[0].message.content || '';
        const code = rawCode
            .replace(/^```[a-z]*\n?/i, '')
            .replace(/```$/g, '')
            .trim();

        if (!code) {
            await prisma.conversation.create({
                data: {
                    role: 'assistant',
                    content: 'Unable to apply the changes. Please try again.',
                    projectId
                }
            })
            await prisma.user.update({
                where: {id: userId},
                data: {credits: {increment: 5}}
            })
            return res.status(500).json({ message: 'AI returned empty response' });
        }

        const version = await prisma.version.create({
            data: {
                code,
                description: 'changes made',
                projectId
            }
        })

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "✅ Done! Your changes are live. Preview the result on the right.",
                projectId
            }
        })

        await prisma.websiteProject.update({
            where: {id: projectId},
            data: {
                current_code: code,
                current_version_index: version.id
            }
        })

        res.json({message: 'Changes made successfully'})

    } catch (error : any) {
        // Only rollback credits and send error if headers not sent yet
        if (!res.headersSent) {
            await prisma.user.update({
                where: {id: userId},
                data: {credits: {increment: 5}}
            }).catch(() => {});
            console.error('makeRevision error:', error.message);
            return res.status(500).json({ message: error.message });
        }
        console.error('makeRevision background error:', error.message);
    }
}

// Controller Function to rollback to a specific version
export const rollbackToVersion = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const { projectId, versionId } = req.params;

        const project = await prisma.websiteProject.findUnique({
            where: {id:  projectId, userId},
            include: {versions: true}
        })

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const version = project.versions.find((version)=>version.id === versionId);

        if(!version){
            return res.status(404).json({ message: 'Version not found' });
        }

        await prisma.websiteProject.update({
            where: {id: projectId, userId},
            data: {
                current_code: version.code,
                current_version_index: version.id
            }
        })

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "I've rolled back your website to selected version. You can now preview it",
                projectId
            }
        })

        res.json({ message: 'Version rolled back' });
    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller Function to Delete a Project
export const deleteProject = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        const { projectId } = req.params;

        await prisma.websiteProject.delete({
            where: {id: projectId, userId},
        })

        res.json({ message: 'Project deleted successfully' });
    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller for getting project code for preview
export const getProjectPreview = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        const { projectId } = req.params;

        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const project = await prisma.websiteProject.findFirst({
            where: {id: projectId, userId},
            include: {versions: true}
        })

        if(!project){
            return res.status(404).json({ message: 'Project not found' });
        }

        res.json({ project });
    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Get published projects
export const getPublishedProjects = async (req: Request, res: Response) => {
    try {
       
        const projects = await prisma.websiteProject.findMany({
            where: {isPublished: true},
            include: {user: true}
        })

        res.json({ projects });
    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Get a single project by id
export const getProjectById = async (req: Request, res: Response) => {
    try {
       const { projectId } = req.params;

        const project = await prisma.websiteProject.findFirst({
            where: {id: projectId},
        })

        if(!project || project.isPublished === false || !project?.current_code){
            return res.status(404).json({ message: 'Project not found' });
        }

        res.json({ code: project.current_code });
    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller to save project code
export const saveProjectCode = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        const { projectId } = req.params;
        const {code} = req.body;

        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if(!code){
            return res.status(400).json({ message: 'Code is required' });
        }

        const project = await prisma.websiteProject.findUnique({
            where: {id: projectId, userId}
        })

        if(!project){
            return res.status(404).json({ message: 'Project not found' });
        }

        await prisma.websiteProject.update({
            where: {id: projectId},
            data: {current_code: code, current_version_index: ''}
        })

        res.json({ message: 'Project saved successfully' });
    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}