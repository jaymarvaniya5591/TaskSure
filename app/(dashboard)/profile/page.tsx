"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUserContext } from "@/lib/user-context";
import { User, Building, Phone, ShieldCheck, Mail, CheckCircle2, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserProfile {
    id: string;
    name: string;
    phone_number: string;
    reporting_manager_id: string | null;
    organisation_id: string | null;
    organisation?: { name: string } | null;
    manager?: { name: string; phone_number: string } | null;
}

export default function ProfilePage() {
    const { userId } = useUserContext();
    const [supabase] = useState(() => createClient());

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Edit states
    const [isEditingName, setIsEditingName] = useState(false);
    const [editName, setEditName] = useState("");

    const [isEditingPhone, setIsEditingPhone] = useState(false);
    const [editPhone, setEditPhone] = useState("");
    const [otpSent, setOtpSent] = useState(false);
    const [otp, setOtp] = useState("");

    const [isEditingManager, setIsEditingManager] = useState(false);
    const [newManagerPhone, setNewManagerPhone] = useState("");
    const [managerVerifySent, setManagerVerifySent] = useState(false);

    const [isEditingCompany, setIsEditingCompany] = useState(false);
    const [companyAction, setCompanyAction] = useState<"join" | "create" | null>(null);
    const [newCompanyName, setNewCompanyName] = useState("");
    const [managerForCompanyPhone, setManagerForCompanyPhone] = useState("");
    const [companyVerifySent, setCompanyVerifySent] = useState(false);

    useEffect(() => {
        async function loadProfile() {
            if (!userId) return;
            try {
                // Fetch the basic user profile
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('id, name, phone_number, reporting_manager_id, organisation_id')
                    .eq('id', userId)
                    .single();

                if (userError) throw userError;

                let orgName = null;
                let managerInfo = null;

                if (userData.organisation_id) {
                    const { data: orgData } = await supabase
                        .from('organisations')
                        .select('name')
                        .eq('id', userData.organisation_id)
                        .single();
                    if (orgData) orgName = orgData.name;
                }

                if (userData.reporting_manager_id) {
                    const { data: managerData } = await supabase
                        .from('users')
                        .select('name, phone_number')
                        .eq('id', userData.reporting_manager_id)
                        .single();
                    if (managerData) managerInfo = managerData;
                }

                const formattedProfile: UserProfile = {
                    ...userData,
                    phone_number: (userData.phone_number || "").replace(/^\+91/, "").replace(/\D/g, ""),
                    organisation: orgName ? { name: orgName } : null,
                    manager: managerInfo ? { ...managerInfo, phone_number: (managerInfo.phone_number || "").replace(/^\+91/, "").replace(/\D/g, "") } : null,
                };

                setProfile(formattedProfile);
                setEditName(formattedProfile.name || "");
                setEditPhone(formattedProfile.phone_number || "");
            } catch (err) {
                console.error("Failed to load profile", err);
            } finally {
                setIsLoading(false);
            }
        }
        loadProfile();
    }, [supabase, userId]);

    // Name Update
    const handleSaveName = async () => {
        if (!editName.trim()) return alert("Name cannot be empty");
        const { error } = await supabase.from('users').update({ name: editName }).eq('id', userId);
        if (error) {
            alert("Failed to update name");
        } else {
            alert("Name updated successfully!");
            setProfile(prev => prev ? { ...prev, name: editName } : null);
            setIsEditingName(false);
        }
    };

    // Phone Update (Mock OTP)
    const handleSendPhoneOtp = () => {
        if (!editPhone || editPhone.length < 10) return alert("Enter a valid phone number");
        setOtpSent(true);
        alert("OTP sent to new phone number!");
    };

    const handleVerifyPhone = async () => {
        if (otp !== "123456") return alert("Invalid OTP. Try 123456.");
        const { error } = await supabase.from('users').update({ phone_number: editPhone }).eq('id', userId);
        if (error) {
            alert("Failed to update phone");
        } else {
            alert("Phone number verified and updated!");
            setProfile(prev => prev ? { ...prev, phone_number: editPhone } : null);
            setIsEditingPhone(false);
            setOtpSent(false);
            setOtp("");
        }
    };

    // Manager Update (Mock Approval)
    const handleRequestManagerChange = () => {
        if (!newManagerPhone || newManagerPhone.length < 10) return alert("Enter a valid manager phone number");
        setManagerVerifySent(true);
        alert("Verification request sent to new manager on WhatsApp!");
        setTimeout(() => {
            setIsEditingManager(false);
            setManagerVerifySent(false);
            setNewManagerPhone("");
        }, 3000);
    };

    // Company Update (Mock Logic)
    const handleCompanySubmit = () => {
        if (companyAction === "create") {
            if (!newCompanyName) return alert("Enter a company name");
            alert("New company created! (Mock)");
            setIsEditingCompany(false);
            setCompanyAction(null);
        } else if (companyAction === "join") {
            if (!managerForCompanyPhone) return alert("Enter manager's phone number to join");
            setCompanyVerifySent(true);
            alert("Verification request sent to manager on WhatsApp!");
            setTimeout(() => {
                setIsEditingCompany(false);
                setCompanyAction(null);
                setCompanyVerifySent(false);
            }, 3000);
        }
    };

    if (isLoading) {
        return <div className="p-8 text-center text-gray-500 font-medium">Loading profile...</div>;
    }

    if (!profile) return null;

    return (
        <div className="max-w-3xl mx-auto pb-12 animate-fade-in-up">
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-8">
                Your Profile
            </h1>

            <div className="space-y-6">

                {/* 1. Name Section */}
                <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className="w-12 h-12 rounded-full shrink-0 bg-blue-50 text-blue-600 flex items-center justify-center pt-0.5">
                            <User className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Full Name</h2>
                            <div className="flex items-center w-full gap-2 mt-1.5 h-10">
                                <div className="flex-1 min-w-0 h-full flex items-center">
                                    {isEditingName ? (
                                        <input
                                            type="text"
                                            value={editName}
                                            onChange={(e) => setEditName(e.target.value)}
                                            className="w-full h-full border border-gray-200 rounded-xl px-3 text-[13px] font-semibold focus:border-gray-400 focus:ring-0 outline-none transition-colors"
                                            placeholder="First and Last Name"
                                        />
                                    ) : (
                                        <p className="text-base font-bold text-gray-900 truncate">{profile.name}</p>
                                    )}
                                </div>
                                <div className="w-[72px] shrink-0 h-full">
                                    {isEditingName ? (
                                        <button onClick={handleSaveName} className="w-full h-full bg-blue-600 text-white rounded-xl text-xs font-bold flex items-center justify-center hover:bg-blue-700 transition-colors truncate px-2">Save</button>
                                    ) : (
                                        <button onClick={() => setIsEditingName(true)} className="w-full h-full text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl flex items-center justify-center transition-colors truncate px-2">Edit</button>
                                    )}
                                </div>
                                {isEditingName && (
                                    <div className="w-8 h-full shrink-0 flex items-center justify-center">
                                        <button onClick={() => setIsEditingName(false)} className="text-gray-400 hover:text-gray-900 hover:bg-gray-100 p-1.5 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Phone Number Section */}
                <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className="w-12 h-12 rounded-full shrink-0 bg-green-50 text-green-600 flex items-center justify-center pt-0.5">
                            <Phone className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Phone Number</h2>
                            <div className="flex items-center w-full gap-2 mt-1.5 h-10">
                                <div className="flex-1 min-w-0 h-full flex items-center">
                                    {isEditingPhone ? (
                                        <input
                                            type={otpSent ? "text" : "tel"}
                                            value={otpSent ? otp : editPhone}
                                            onChange={(e) => otpSent ? setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)) : setEditPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                            className="w-full h-full border border-gray-200 rounded-xl px-3 text-[13px] font-semibold focus:border-gray-400 focus:ring-0 outline-none transition-colors"
                                            placeholder={otpSent ? "6-digit OTP" : "10-digit phone"}
                                            maxLength={otpSent ? 6 : 10}
                                        />
                                    ) : (
                                        <div className="flex items-center gap-1.5 truncate">
                                            <p className="text-base font-bold text-gray-900 truncate">{profile.phone_number || "Not set"}</p>
                                            {profile.phone_number && <CheckCircle2 className="shrink-0 w-4 h-4 text-green-600" />}
                                        </div>
                                    )}
                                </div>
                                <div className="w-[72px] shrink-0 h-full">
                                    {isEditingPhone ? (
                                        otpSent ? (
                                            <button onClick={handleVerifyPhone} className="w-full h-full bg-gray-900 text-white rounded-xl text-xs font-bold flex items-center justify-center hover:bg-gray-800 transition-colors truncate px-2">Verify</button>
                                        ) : (
                                            <button onClick={handleSendPhoneOtp} className="w-full h-full bg-green-600 text-white rounded-xl text-xs font-bold flex items-center justify-center hover:bg-green-700 transition-colors truncate px-2">Send</button>
                                        )
                                    ) : (
                                        <button onClick={() => { setIsEditingPhone(true); setOtpSent(false); }} className="w-full h-full text-xs font-bold text-green-600 bg-green-50 hover:bg-green-100 rounded-xl flex items-center justify-center transition-colors truncate px-2">Edit</button>
                                    )}
                                </div>
                                {isEditingPhone && (
                                    <div className="w-8 h-full shrink-0 flex items-center justify-center">
                                        <button onClick={() => { setIsEditingPhone(false); setOtpSent(false); }} className="text-gray-400 hover:text-gray-900 hover:bg-gray-100 p-1.5 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 3. Manager Section */}
                <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className="w-12 h-12 rounded-full shrink-0 bg-purple-50 text-purple-600 flex items-center justify-center pt-0.5">
                            <ShieldCheck className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Your Manager</h2>
                            <div className="flex items-center w-full gap-2 mt-1.5 h-10">
                                <div className="flex-1 min-w-0 h-full flex items-center">
                                    {isEditingManager ? (
                                        managerVerifySent ? (
                                            <div className="w-full h-full flex items-center px-3 bg-amber-50 border border-amber-100 rounded-xl text-[13px] font-medium text-amber-600 truncate">Pending approval</div>
                                        ) : (
                                            <input
                                                type="tel"
                                                value={newManagerPhone}
                                                onChange={(e) => setNewManagerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                                className="w-full h-full border border-gray-200 rounded-xl px-3 text-[13px] font-semibold focus:border-gray-400 focus:ring-0 outline-none transition-colors"
                                                placeholder="10-digit phone"
                                                maxLength={10}
                                            />
                                        )
                                    ) : (
                                        <div className="flex items-center min-w-0 w-full h-full">
                                            {profile.manager ? (
                                                <p className="text-base font-bold text-gray-900 truncate">{profile.manager.name}</p>
                                            ) : (
                                                <p className="text-base font-bold text-gray-400 italic truncate">No manager assigned</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="w-[72px] shrink-0 h-full">
                                    {isEditingManager ? (
                                        !managerVerifySent && (
                                            <button onClick={handleRequestManagerChange} className="w-full h-full bg-purple-600 text-white rounded-xl text-xs font-bold flex items-center justify-center hover:bg-purple-700 transition-colors truncate px-2">Send</button>
                                        )
                                    ) : (
                                        <button onClick={() => { setIsEditingManager(true); setNewManagerPhone(profile.manager?.phone_number || ''); }} className="w-full h-full text-xs font-bold text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-xl flex items-center justify-center transition-colors truncate px-2">Edit</button>
                                    )}
                                </div>
                                {isEditingManager && (
                                    <div className="w-8 h-full shrink-0 flex items-center justify-center">
                                        <button onClick={() => setIsEditingManager(false)} className="text-gray-400 hover:text-gray-900 hover:bg-gray-100 p-1.5 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 4. Company Section */}
                <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className="w-12 h-12 rounded-full shrink-0 bg-orange-50 text-orange-600 flex items-center justify-center pt-0.5">
                            <Building className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Company / Organisation</h2>
                            <div className="flex items-center w-full gap-2 mt-1.5 h-10">
                                <div className="flex-1 min-w-0 h-full flex items-center">
                                    {isEditingCompany ? (
                                        !companyAction ? (
                                            <div className="flex items-center gap-2 w-full h-full">
                                                <button onClick={() => setCompanyAction('join')} className="flex-1 h-full border border-gray-200 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-bold text-gray-700 transition-colors">Join</button>
                                                <button onClick={() => setCompanyAction('create')} className="flex-1 h-full border border-gray-200 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-bold text-gray-700 transition-colors">Create</button>
                                            </div>
                                        ) : companyVerifySent ? (
                                            <div className="w-full h-full flex items-center px-3 bg-amber-50 border border-amber-100 rounded-xl text-[13px] font-medium text-amber-600 truncate">Pending approval</div>
                                        ) : (
                                            <input
                                                type={companyAction === "join" ? "tel" : "text"}
                                                value={companyAction === "join" ? managerForCompanyPhone : newCompanyName}
                                                onChange={(e) => companyAction === "join" ? setManagerForCompanyPhone(e.target.value.replace(/\D/g, '').slice(0, 10)) : setNewCompanyName(e.target.value)}
                                                className="w-full h-full border border-gray-200 rounded-xl px-3 text-[13px] font-semibold focus:border-gray-400 focus:ring-0 outline-none transition-colors"
                                                placeholder={companyAction === "join" ? "10-digit phone" : "Company Name"}
                                                maxLength={companyAction === "join" ? 10 : undefined}
                                            />
                                        )
                                    ) : (
                                        <p className="text-base font-bold text-gray-900 truncate">{profile.organisation?.name || "Independent / Not Assigned"}</p>
                                    )}
                                </div>
                                <div className="w-[72px] shrink-0 h-full">
                                    {isEditingCompany ? (
                                        companyAction && !companyVerifySent && (
                                            <button onClick={handleCompanySubmit} className="w-full h-full bg-orange-600 text-white rounded-xl text-xs font-bold flex items-center justify-center hover:bg-orange-700 transition-colors truncate px-2">Submit</button>
                                        )
                                    ) : (
                                        <button onClick={() => setIsEditingCompany(true)} className="w-full h-full text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-xl flex items-center justify-center transition-colors truncate px-2">Edit</button>
                                    )}
                                </div>
                                {isEditingCompany && (
                                    <div className="w-8 h-full shrink-0 flex items-center justify-center">
                                        <button onClick={() => { setIsEditingCompany(false); setCompanyVerifySent(false); setCompanyAction(null); }} className="text-gray-400 hover:text-gray-900 hover:bg-gray-100 p-1.5 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
