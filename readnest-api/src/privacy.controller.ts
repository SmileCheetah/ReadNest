import { Controller, Get, Header } from '@nestjs/common';

@Controller('privacy')
export class PrivacyController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getPrivacyPolicy() {
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unwind 개인정보처리방침</title></head><body style="font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.7;color:#222"><h1>Unwind 개인정보처리방침</h1><p>시행일: 2026년 9월 3일</p><p>Unwind(이하 “서비스”)는 Threads 등에서 발견한 글을 저장하고 요약해 다시 읽을 수 있도록 돕는 서비스입니다.</p><h2>1. 수집하는 정보</h2><ul><li>회원가입 및 로그인: 이메일 주소, 닉네임, 비밀번호의 암호화된 저장값</li><li>서비스 이용: 사용자가 저장한 게시물 URL, 게시물 내용 및 읽음 상태</li><li>기기 권한 및 광고 식별자: 수집하지 않습니다.</li></ul><h2>2. 이용 목적</h2><p>회원 인증, 저장 글 관리, 원문 추출 및 AI 요약 제공, 서비스 오류 대응을 위해 정보를 이용합니다.</p><h2>3. 보관 및 삭제</h2><p>정보는 회원이 서비스를 이용하는 동안 보관합니다. 회원 탈퇴 또는 삭제 요청 시 관련 법령상 보관이 필요한 경우를 제외하고 지체 없이 삭제합니다.</p><h2>4. 제3자 제공 및 처리</h2><p>서비스 제공을 위해 저장된 게시물 내용을 원문 추출 및 요약 처리에 사용할 수 있습니다. 법령에 따른 경우를 제외하고 개인정보를 판매하거나 광고 목적으로 제3자에게 제공하지 않습니다.</p><h2>5. 문의</h2><p>개인정보 관련 문의: <a href="mailto:kkzw188372@gmail.com">kkzw188372@gmail.com</a></p><p>본 방침은 서비스 변경 또는 법령 변경에 따라 수정될 수 있으며, 변경 시 이 페이지에 게시합니다.</p></body></html>`;
  }
}
