import { Request, Response } from 'express';
import openai, { AI_MODEL } from '../configs/openai.js';
import { 
    buildReactComponentSystemPrompt, 
    buildReactComponentUserPrompt,
    JOINT_GENERATION_SYSTEM_PROMPT,
    buildJointUserPrompt 
} from '../lib/prompts.js';
import prisma from '../lib/prisma.js';

export const generateComponent = async (req: Request, res: Response) => {
    const userId = req.userId;
    const { sectionType, prompt, projectId } = req.body;

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!userId || !user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (user.credits < 1) {
            return res.status(403).json({ message: 'Add more credits to generate React components (Cost: 1 credit)' });
        }

        if (!sectionType || !prompt) {
            return res.status(400).json({ message: 'Section type and prompt are required' });
        }

        // Fetch current project HTML if projectId is provided
        let currentHtml = '';
        if (projectId) {
            const project = await prisma.websiteProject.findUnique({
                where: { id: projectId, userId }
            });
            currentHtml = project?.current_code || '';
        }

        // Deduct credits
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: 1 } }
        });

        let jsx = '';
        let htmlContent = '';

        if (projectId && currentHtml) {
            // JOINT GENERATION: JSX + FULL HTML UPDATE
            const completion = await openai.chat.completions.create({
                model: AI_MODEL,
                temperature: 0.3,
                max_tokens: 4000,
                response_format: { type: "json_object" },
                messages: [
                    { role: 'system', content: JOINT_GENERATION_SYSTEM_PROMPT },
                    { role: 'user', content: buildJointUserPrompt(sectionType, prompt, currentHtml) }
                ]
            });

            const content = completion.choices[0].message.content || '{}';
            let result;
            try {
                result = JSON.parse(content);
            } catch (e) {
                // Fallback: Try to strip markdown if it accidentally appeared
                const stripped = content.replace(/```json\n?|```/g, '').trim();
                result = JSON.parse(stripped);
            }

            jsx = result.jsx || '';
            htmlContent = result.html || '';

            if (htmlContent) {
                // Save new version and update project
                const version = await prisma.version.create({
                    data: {
                        code: htmlContent,
                        description: `Added ${sectionType} component`,
                        projectId
                    }
                })

                await prisma.conversation.create({
                    data: {
                        role: 'user',
                        content: `(React Gen) Add ${sectionType}: ${prompt}`,
                        projectId
                    }
                })

                await prisma.conversation.create({
                    data: {
                        role: 'assistant',
                        content: `✨ Integrated new ${sectionType} component into your website. JSX is also ready for download.`,
                        projectId
                    }
                })

                await prisma.websiteProject.update({
                    where: { id: projectId },
                    data: {
                        current_code: htmlContent,
                        current_version_index: version.id
                    }
                })
            }
        } else {
            // STANDALONE JSX ONLY
            const completion = await openai.chat.completions.create({
                model: AI_MODEL,
                temperature: 0.3,
                messages: [
                    { role: 'system', content: buildReactComponentSystemPrompt(sectionType) },
                    { role: 'user', content: buildReactComponentUserPrompt(sectionType, prompt) }
                ]
            });
            jsx = completion.choices[0].message.content || '';
        }

        res.json({ code: jsx });
    } catch (error: any) {
        // Rollback credits on error
        if (userId) {
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 1 } }
            }).catch(() => {});
        }
        console.error('generateComponent error:', error.message);
        res.status(500).json({ message: error.message });
    }
};
