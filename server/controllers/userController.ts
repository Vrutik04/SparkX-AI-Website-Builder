import {Request, Response} from 'express'
import prisma from '../lib/prisma.js';
import openai, { AI_MODEL } from '../configs/openai.js';
import Stripe from 'stripe'
import {
    HTML_SYSTEM_PROMPT,
    ENHANCE_CREATION_SYSTEM_PROMPT,
    buildWebsiteUserPrompt
} from '../lib/prompts.js';

// Get User Credits
export const getUserCredits = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: {id: userId}
        })

        res.json({credits: user?.credits})
    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller Function to create New Project
export const createUserProject = async (req: Request, res: Response) => {
    const userId = req.userId;
    try {
        const { initial_prompt } = req.body;

        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: {id: userId}
        })

        if(user && user.credits < 5){
            return res.status(403).json({ message: 'add credits to create more projects' });
        }

        // Create a new project
        const project = await prisma.websiteProject.create({
            data: {
                name: initial_prompt.length > 50 ? initial_prompt.substring(0, 47) + '...' : initial_prompt,
                initial_prompt,
                userId
            }
        })

        // Update User's Total Creation
        await prisma.user.update({
            where: {id: userId},
            data: {totalCreation: {increment: 1}}
        })

        await prisma.conversation.create({
            data: {
                role: 'user',
                content: initial_prompt,
                projectId: project.id
            }
        })

        await prisma.user.update({
            where: {id: userId},
            data: {credits: {decrement: 5}}
        })

        // Inform user that generation has started
        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'Generating your website now...',
                projectId: project.id
            }
        })

        // Send projectId immediately so the client can navigate
        res.json({projectId: project.id})

        // STEP 1: Enhance the user's prompt (fast call — max 300 tokens)
        const promptEnhanceResponse = await openai.chat.completions.create({
            model: AI_MODEL,
            temperature: 0.4,
            max_tokens: 300,
            messages: [
                { role: 'system', content: ENHANCE_CREATION_SYSTEM_PROMPT },
                { role: 'user', content: initial_prompt }
            ]
        })

        const enhancedPrompt = promptEnhanceResponse.choices[0].message.content || initial_prompt;

        // Store enhancement in conversation so the user sees it
        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `✨ Enhanced your idea: "${enhancedPrompt}"`,
                projectId: project.id
            }
        })

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'Building your website now...',
                projectId: project.id
            }
        })

        // STEP 2: Generate website using the enhanced prompt
        const codeGenerationResponse = await openai.chat.completions.create({
            model: AI_MODEL,
            temperature: 0.3,
            max_tokens: 8000,
            messages: [
                { role: 'system', content: HTML_SYSTEM_PROMPT },
                { role: 'user', content: buildWebsiteUserPrompt(enhancedPrompt) }
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
                    content: 'Unable to generate the code. Please try again.',
                    projectId: project.id
                }
            })
            await prisma.user.update({
                where: {id: userId},
                data: {credits: {increment: 5}}
            })
            return;
        }

        // Create Version for the project
        const version = await prisma.version.create({
            data: {
                code,
                description: 'Initial version',
                projectId: project.id
            }
        })

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "🎉 Your website is ready! Preview it on the right and use the chat to request any changes.",
                projectId: project.id
            }
        })

        await prisma.websiteProject.update({
            where: {id: project.id},
            data: {
                current_code: code,
                current_version_index: version.id
            }
        })

    } catch (error : any) {
        // Rollback credits if project creation failed before response was sent
        if (!res.headersSent) {
            await prisma.user.update({
                where: {id: userId},
                data: {credits: {increment: 5}}
            })
            console.error("Error creating project:", error);
            return res.status(500).json({ message: error.message });
        }
        
        // If headers already sent, we just log the background error
        console.error("Background task error:", error);
        
        // Optionally update the conversation to inform the user of the failure
        try {
            // We can't use 'project' here if it wasn't defined, but if we got past res.json, project.id exists
            // In a real app, you might want to use a more robust background job system
        } catch (innerError) {
            console.error("Failed to log background error to DB:", innerError);
        }
    }
}

// Controller Function to Get A Single User Project
export const getUserProject = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const {projectId} = req.params;

       const project = await prisma.websiteProject.findUnique({
        where: {id: projectId, userId},
        include: {
            conversation: {
                orderBy: {timestamp: 'asc'}
            },
            versions: {orderBy: {timestamp: 'asc'}}
        }
       })

        res.json({project})

    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller Function to Get All Users Projects
export const getUserProjects = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

       const projects = await prisma.websiteProject.findMany({
        where: {userId},
        orderBy: {updatedAt: 'desc'}
       })

        res.json({projects})

    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller Function to Toggle Project Publish
export const togglePublish = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const {projectId} = req.params;

        const project = await prisma.websiteProject.findUnique({
            where: {id: projectId, userId}
        })

        if(!project){
            return res.status(404).json({ message: 'Project not found' });
        }

        await prisma.websiteProject.update({
            where: {id: projectId},
            data: {isPublished: !project.isPublished}
        })
       
        res.json({message: project.isPublished ? 'Project Unpublished' : 'Project Published Successfully'})

    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller Function to Purchase Credits
export const purchaseCredits = async (req: Request, res: Response) => {
    try {
        interface Plan {
            credits: number;
            amount: number;
        }

        const plans = {
            basic: {credits: 100, amount: 5},
            pro: {credits: 400, amount: 19},
            enterprise: {credits: 1000, amount: 49},
        }

        const userId = req.userId;
        const {planId} = req.body as {planId: keyof typeof plans}
        const origin = req.headers.origin as string;

        const plan: Plan = plans[planId]

        if(!plan){
            return res.status(404).json({ message: 'Plan not found' });
        }

        const transaction = await prisma.transaction.create({
            data: {
                userId: userId!,
                planId: req.body.planId,
                amount: plan.amount,
                credits: plan.credits
            }
        })

        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

        const session = await stripe.checkout.sessions.create({
                success_url: `${origin}/loading`,
                cancel_url: `${origin}`,
                line_items: [
                    {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `AiSiteBuilder - ${plan.credits} credits`
                        },
                        unit_amount: Math.floor(transaction.amount) * 100
                    },
                    quantity: 1
                    },
                ],
                mode: 'payment',
                metadata: {
                    transactionId: transaction.id,
                    appId: 'ai-site-builder'
                },
                expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // Expires in 30 minutes
                });

        res.json({payment_link: session.url})

    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}