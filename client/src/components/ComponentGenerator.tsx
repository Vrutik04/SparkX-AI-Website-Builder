import React, { useState } from 'react';
import { CopyIcon, DownloadIcon, Loader2Icon, SparklesIcon } from 'lucide-react';
import api from '@/configs/axios';
import { toast } from 'sonner';

interface ComponentGeneratorProps {
    projectId?: string;
    onGenerateSuccess?: () => void;
}

const ComponentGenerator = ({ projectId, onGenerateSuccess }: ComponentGeneratorProps) => {
    const [sectionType, setSectionType] = useState('hero');
    const [prompt, setPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedCode, setGeneratedCode] = useState('');

    const sectionTypes = [
        { id: 'hero', label: 'Hero Section' },
        { id: 'features', label: 'Features' },
        { id: 'pricing', label: 'Pricing' },
        { id: 'testimonials', label: 'Testimonials' },
        { id: 'navbar', label: 'Navigation Bar' },
        { id: 'footer', label: 'Footer' },
        { id: 'cta', label: 'Call to Action' },
        { id: 'faq', label: 'FAQ' },
    ];

    const handleGenerate = async () => {
        if (!prompt.trim()) return toast.error('Please enter a description for the component');
        
        setIsGenerating(true);
        try {
            const { data } = await api.post('/api/component/generate', {
                sectionType,
                prompt,
                projectId
            });
            setGeneratedCode(data.code);
            toast.success('Generated and synced with website!');
            
            if (onGenerateSuccess) {
                onGenerateSuccess();
            }
        } catch (error: any) {
            toast.error(error?.response?.data?.message || error.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(generatedCode);
        toast.success('Copied to clipboard!');
    };

    const handleDownload = () => {
        const element = document.createElement('a');
        const file = new Blob([generatedCode], { type: 'text/javascript' });
        element.href = URL.createObjectURL(file);
        element.download = `${sectionType}.jsx`;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    };

    return (
        <div className="flex flex-col h-full bg-gray-900 text-gray-100 p-4 overflow-y-auto no-scrollbar">
            <div className="mb-6">
                <h2 className="text-xl font-bold flex items-center gap-2 mb-2">
                    <SparklesIcon className="size-5 text-indigo-400" />
                    React Generator
                </h2>
                <p className="text-xs text-gray-400">
                    Generate standalone production-ready React components using Tailwind CSS. 
                    (Cost: 1 credit)
                </p>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Section Type
                    </label>
                    <select
                        value={sectionType}
                        onChange={(e) => setSectionType(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        {sectionTypes.map((type) => (
                            <option key={type.id} value={type.id}>
                                {type.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Description / Prompt
                    </label>
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="e.g., A dark themed hero section for a creative agency with a glassmorphism CTA..."
                        rows={4}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none placeholder:text-gray-600"
                    />
                </div>

                <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="w-full bg-linear-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {isGenerating ? (
                        <>
                            <Loader2Icon className="size-4 animate-spin" />
                            Generating...
                        </>
                    ) : (
                        <>
                            <SparklesIcon className="size-4" />
                            Generate Component
                        </>
                    )}
                </button>
            </div>

            {generatedCode && (
                <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-bottom-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Generated JSX
                        </h3>
                        <div className="flex gap-2">
                            <button
                                onClick={handleCopy}
                                className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded-md transition-colors text-gray-400 hover:text-white"
                                title="Copy code"
                            >
                                <CopyIcon className="size-4" />
                            </button>
                            <button
                                onClick={handleDownload}
                                className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded-md transition-colors text-gray-400 hover:text-white"
                                title="Download .jsx"
                            >
                                <DownloadIcon className="size-4" />
                            </button>
                        </div>
                    </div>
                    <div className="bg-gray-950 rounded-lg p-4 border border-gray-800 overflow-x-auto">
                        <pre className="text-[11px] font-mono leading-relaxed text-gray-300">
                            {generatedCode}
                        </pre>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ComponentGenerator;
